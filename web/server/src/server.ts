import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { runProcess } from "./process.js";
import { analyzeJavaSource, executeJava, type AdapterOutcome } from "./java-adapter.js";
import { executeCustom } from "./custom-adapter.js";
import { analyzeToy } from "./toy-analyzer.js";
import { ContractValidator } from "./contract-validator.js";
import type { Config } from "./config.js";
import { config as defaultConfig } from "./config.js";
import type { Engine, Metric, PhaseInfo, RunRequest, RunResult, Sample, StaticAnalysisResult, StructuredError } from "@gcd/shared";

interface StoredRun {
  result: RunResult;
  runDir: string;
  abort: AbortController;
  completion?: Promise<void>;
}

interface AnalyzeRequest {
  engine: Engine;
  source: string;
}

const ulidAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const runIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const allowedHosts = new Set(["localhost", "127.0.0.1"]);
const maxRunCount = 20;
const runTtlMs = 24 * 60 * 60 * 1_000;

function newRunId(): string {
  let time = Date.now();
  let timePart = "";
  for (let index = 0; index < 10; index++) {
    timePart = ulidAlphabet[time % 32]! + timePart;
    time = Math.floor(time / 32);
  }
  const random = BigInt(`0x${randomBytes(10).toString("hex")}`);
  let randomPart = "";
  for (let index = 0; index < 16; index++) {
    randomPart = ulidAlphabet[Number((random >> BigInt(index * 5)) & 31n)]! + randomPart;
  }
  return `${timePart}${randomPart}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAnalyzeRequest(value: unknown): value is AnalyzeRequest {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "engine" && key !== "source")) {
    return false;
  }
  return (value.engine === "jvm" || value.engine === "custom") && typeof value.source === "string";
}

function structuredError(
  code: string,
  phase: StructuredError["phase"],
  message: string
): StructuredError {
  return { code, phase, message: message.slice(0, 2_000) };
}

function unavailable(unit: string, note: string): Metric {
  return {
    value: null,
    unit,
    provenance: "unavailable",
    source: "controller fallback",
    note
  };
}

function phase(status: PhaseInfo["status"], durationMs: number, source: string): PhaseInfo {
  return {
    status,
    durationMs: { value: durationMs, unit: "ms", provenance: "measured", source }
  };
}

function emptyJvmResult(config: Config): Record<string, unknown> {
  return {
    kind: "jvm",
    jvm: { version: config.jdkVersion, vendor: config.jdkVendor, collector: "serial", flags: [] },
    totals: {
      compileMs: unavailable("ms", "Java analysis did not complete"),
      wallTimeMs: unavailable("ms", "Java execution did not complete"),
      jvmUptimeMs: unavailable("ms", "Java execution did not complete"),
      gcCount: unavailable("collections", "Java execution did not complete"),
      gcPauseTotalMs: unavailable("ms", "Java execution did not complete"),
      allocatedBytesMainThread: unavailable("bytes", "Java execution did not complete"),
      heapPeakUsed: unavailable("bytes", "Java execution did not complete"),
      objectsReclaimed: unavailable("objects", "HotSpot object counts are not exposed"),
      objectsMarked: unavailable("objects", "HotSpot mark counts are not exposed"),
      rootSet: unavailable("objects", "HotSpot roots are not exposed"),
      objectGraph: unavailable("objects", "HotSpot object graph is not exposed"),
      edgesExamined: unavailable("edges", "HotSpot traversal work is not exposed")
    },
    perCollector: [],
    collections: []
  };
}

function emptyCustomResult(config: Config): Record<string, unknown> {
  const note = "Custom runner did not produce an engine result";
  const metric = unavailable("count", note);
  return {
    kind: "custom",
    runtime: {
      version: "v2",
      gitCommit: config.gitCommit,
      heap: { regionSize: 0, slotReuse: false, observer: false }
    },
    totals: {
      allocations: { ...metric, unit: "objects" },
      collections: metric,
      freed: { ...metric, unit: "objects" },
      liveAfter: { ...metric, unit: "objects" },
      estimatedBytesFreed: { ...metric, unit: "B", provenance: "estimated" },
      estimatedLiveBytes: { ...metric, unit: "B", provenance: "estimated" },
      statementsExecuted: metric,
      wallTimeMs: { ...metric, unit: "ms" },
      pauseFraction: { ...metric, unit: "ratio" }
    },
    collections: [],
    snapshots: []
  };
}

function fallbackAnalysis(engine: Engine): StaticAnalysisResult {
  return engine === "custom"
    ? analyzeToy("")
    : {
        schema: "gcd.static-analysis/1",
        language: "java",
        ast: null,
        nodeCount: 0,
        truncated: false,
        diagnostics: [],
        java: {
          mainClass: null,
          publicTypeName: null,
          packageName: null,
          compileMs: unavailable("ms", "Java analysis did not complete")
        }
      };
}

function emptyLimits(config: Config, engine: Engine, source: string) {
  return {
    sourceBytes: Buffer.byteLength(source, "utf8"),
    stdoutBytes: 65_536,
    prlimit: process.platform === "linux" ? "applied" : "unsupported-platform",
    analysisTimeoutMs: engine === "jvm" ? config.analysisTimeoutMs : 0,
    executionTimeoutMs: engine === "jvm" ? 10_000 : 5_000,
    cpuSeconds: engine === "jvm" ? 20 : 10,
    ...(engine === "jvm" ? { heapMiB: 64, fileBytes: 64 * 1024 * 1024, openFiles: 256, addressSpaceBytes: null } : {
      fileBytes: 128 * 1024 * 1024,
      openFiles: 64,
      addressSpaceBytes: 1024 * 1024 * 1024
    })
  };
}

function finalResult(
  config: Config,
  entry: StoredRun,
  outcome: AdapterOutcome | { status: RunResult["status"]; result: Partial<RunResult> },
  startedAt: string
): RunResult {
  const base = entry.result;
  if ("result" in outcome) {
    const result = outcome.result;
    return {
      ...base,
      startedAt,
      endedAt: new Date().toISOString(),
      status: outcome.status,
      phases: result.phases ?? {
        analysis: phase("skipped", 0, "custom runner"),
        execute: phase(outcome.status === "succeeded" ? "ok" : "failed", 0, "controller")
      },
      output: result.output ?? { stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false },
      errors: result.errors ?? [],
      staticAnalysis: result.staticAnalysis ?? fallbackAnalysis("custom"),
      engineResult: result.engineResult ?? emptyCustomResult(config),
      ...(result.trace ? { trace: result.trace } : {}),
      limits: { ...base.limits, ...(result.limits ?? {}) },
      toolVersions: {
        ...base.toolVersions,
        ...(result.toolVersions ?? {}),
        controller: "2.0.0",
        gitCommit: config.gitCommit
      }
    };
  }
  return {
    ...base,
    startedAt,
    endedAt: new Date().toISOString(),
    status: outcome.status,
    phases: outcome.phases as RunResult["phases"],
    output: outcome.output,
    errors: outcome.errors,
    staticAnalysis: outcome.staticAnalysis,
    engineResult: outcome.engineResult,
    limits: outcome.limits,
    toolVersions: outcome.toolVersions
  };
}

async function ensureRunRoot(config: Config): Promise<void> {
  await mkdir(config.runRoot, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(config.runRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error(`Run directory root is not a real directory: ${config.runRoot}`);
  }
  if (typeof process.getuid === "function" && rootInfo.uid !== process.getuid()) {
    throw new Error(`Run directory root is not owned by the current user: ${config.runRoot}`);
  }
  await chmod(config.runRoot, 0o700);
}

async function killOrphan(pidFile: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(pidFile, "utf8");
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return;
    throw error;
  }
  const pid = Number(content.trim());
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) return;
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL");
  } catch (error) {
    if (!isRecord(error) || error.code !== "ESRCH") throw error;
  }
}

async function sweepRunRoot(config: Config): Promise<void> {
  await ensureRunRoot(config);
  for (const name of await readdir(config.runRoot)) {
    if (!runIdPattern.test(name)) continue;
    const directory = join(config.runRoot, name);
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) continue;
    await killOrphan(join(directory, "process-group.pid"));
    await rm(directory, { recursive: true, force: true });
  }
}

async function pruneRunRoot(config: Config, runs: Map<string, StoredRun>): Promise<void> {
  const rows: Array<{ name: string; path: string; modifiedAt: number }> = [];
  for (const name of await readdir(config.runRoot)) {
    if (!runIdPattern.test(name)) continue;
    const path = join(config.runRoot, name);
    const info = await stat(path);
    if (info.isDirectory()) rows.push({ name, path, modifiedAt: info.mtimeMs });
  }
  rows.sort((a, b) => b.modifiedAt - a.modifiedAt);
  const cutoff = Date.now() - runTtlMs;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const stored = runs.get(row.name);
    if (stored && stored.result.status === "running") continue;
    if (index >= maxRunCount || row.modifiedAt < cutoff) {
      await rm(row.path, { recursive: true, force: true });
      runs.delete(row.name);
    }
  }
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function validateRequestSecurity(request: FastifyRequest, reply: FastifyReply, port: number): boolean {
  if (!isLoopbackAddress(request.ip)) {
    reply.code(403).send({ error: structuredError("BAD_REQUEST", "request", "Loopback clients only") });
    return false;
  }
  const host = request.headers.host;
  if (!host) {
    reply.code(403).send({ error: structuredError("BAD_REQUEST", "request", "Host header is required") });
    return false;
  }
  let parsedHost: URL;
  try {
    parsedHost = new URL(`http://${host}`);
  } catch {
    reply.code(403).send({ error: structuredError("BAD_REQUEST", "request", "Invalid Host header") });
    return false;
  }
  const actualPort = parsedHost.port ? Number(parsedHost.port) : port;
  if (!allowedHosts.has(parsedHost.hostname.toLowerCase()) || actualPort !== port) {
    reply.code(403).send({ error: structuredError("BAD_REQUEST", "request", "Host is not allowed") });
    return false;
  }
  const origin = request.headers.origin;
  if (origin !== undefined) {
    try {
      const parsedOrigin = new URL(origin);
      if (
        parsedOrigin.protocol !== "http:" ||
        parsedOrigin.host.toLowerCase() !== host.toLowerCase()
      ) {
        reply.code(403).send({ error: structuredError("BAD_REQUEST", "request", "Origin must match Host") });
        return false;
      }
    } catch {
      reply.code(403).send({ error: structuredError("BAD_REQUEST", "request", "Invalid Origin header") });
      return false;
    }
  }
  if (request.method === "POST") {
    const contentType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      reply.code(415).send({ error: structuredError("BAD_REQUEST", "request", "POST requires application/json") });
      return false;
    }
  }
  return true;
}

async function loadSamples(root: string): Promise<Sample[]> {
  const samples: Sample[] = [];
  for (const [engine, folder, suffix] of [
    ["jvm", "java", ".java"],
    ["custom", "custom", ".gc"]
  ] as const) {
    const directory = join(root, "web", "server", "samples", folder);
    for (const name of (await readdir(directory)).filter((item) => item.endsWith(suffix)).sort()) {
      samples.push({
        engine,
        name: name.slice(0, -suffix.length),
        source: await readFile(join(directory, name), "utf8")
      });
    }
  }
  return samples;
}

async function probeJdk(config: Config): Promise<void> {
  const javaHome = dirname(dirname(config.javaPath));
  const env = {
    PATH: [join(javaHome, "bin"), "/usr/bin", "/bin"].join(delimiter),
    HOME: config.runRoot,
    LANG: "C.UTF-8",
    JAVA_HOME: javaHome
  };
  const result = await runProcess(config.javaPath, ["-version"], {
    cwd: config.root,
    env,
    timeoutMs: 2_000,
    keepOutputBytes: 8_192,
    killOutputBytes: 16_384
  });
  const text = `${result.stderr}\n${result.stdout}`;
  const version = /version "([^"]+)"/.exec(text)?.[1] ?? /(?:openjdk|java) (\d+(?:\.\d+)?[^\s]*)/i.exec(text)?.[1];
  if (version) config.jdkVersion = version;
  if (/Temurin|Eclipse Adoptium/i.test(text)) config.jdkVendor = "Eclipse Adoptium";
  else if (/OpenJDK/i.test(text)) config.jdkVendor = "OpenJDK";
  else if (result.exitCode !== 0) throw new Error(`Unable to probe JDK: ${text.trim()}`);
}

export async function createServer(config: Config = defaultConfig): Promise<FastifyInstance> {
  await sweepRunRoot(config);
  const validator = await ContractValidator.load(config);
  const samples = await loadSamples(config.root);
  const runs = new Map<string, StoredRun>();
  let activeRunId: string | undefined;
  const app = Fastify({ logger: true, bodyLimit: 512 * 1024, trustProxy: false });
  app.addHook("onRequest", async (request, reply) => {
    if (!validateRequestSecurity(request, reply, config.port)) return reply;
  });

  app.get("/api/health", async () => {
    let jdkFound = false;
    let jdkError: string | undefined;
    try {
      await probeJdk(config);
      jdkFound = true;
    } catch (error) {
      jdkError = String(error);
    }
    return {
      status: "ok",
      controller: "2.0.0",
      jdk: { found: jdkFound, version: config.jdkVersion, vendor: config.jdkVendor, ...(jdkError ? { error: jdkError } : {}) },
      javaAnalyzer: { found: existsSync(config.javaJarPath) },
      customRunner: { found: existsSync(config.runnerPath), path: config.runnerPath },
      platformLimits: { prlimit: process.platform === "linux" ? "available" : "unsupported-platform" }
    };
  });

  app.get("/api/samples", async () => ({
    jvm: samples.filter((sample) => sample.engine === "jvm"),
    custom: samples.filter((sample) => sample.engine === "custom")
  }));

  app.post("/api/analyze", async (request, reply) => {
    if (!isAnalyzeRequest(request.body)) {
      return reply.code(400).send({ error: structuredError("BAD_REQUEST", "request", "Expected {engine, source}") });
    }
    const sourceBytes = Buffer.byteLength(request.body.source, "utf8");
    if (sourceBytes > config.sourceBytes) {
      return reply.code(413).send({ error: structuredError("SOURCE_TOO_LARGE", "request", "Source exceeds 65,536 UTF-8 bytes") });
    }
    if (activeRunId) {
      return reply.code(409).send({ error: structuredError("BUSY", "request", "Another engine operation is active") });
    }
    if (request.body.engine === "jvm" && !existsSync(config.javaJarPath)) {
      return reply.code(503).send({ error: structuredError("ENGINE_UNAVAILABLE", "analysis", "Java analyzer JAR is not built") });
    }
    activeRunId = "analysis";
    const runId = newRunId();
    const runDir = join(config.runRoot, runId);
    try {
      await mkdir(runDir, { mode: 0o700 });
      const analysis = request.body.engine === "custom"
        ? analyzeToy(request.body.source)
        : await analyzeJavaSource(config, request.body.source, runDir, undefined, true);
      const errors = validator.validate("static-analysis.schema.json", analysis);
      if (errors.length > 0) {
        request.log.error({ errors }, "Static-analysis result failed schema validation");
        return reply.code(500).send({ error: structuredError("SCHEMA_VIOLATION", "controller", errors.join("; ")) });
      }
      return reply.code(200).send(analysis);
    } catch (error) {
      request.log.error({ error }, "Analysis failed");
      return reply.code(500).send({ error: structuredError("INTERNAL", "analysis", String(error)) });
    } finally {
      activeRunId = undefined;
      await rm(runDir, { recursive: true, force: true });
    }
  });

  app.post("/api/runs", async (request, reply) => {
    const body = request.body;
    if (!isRecord(body) || typeof body.source !== "string") {
      return reply.code(400).send({ error: structuredError("BAD_REQUEST", "request", "Run request must contain a source string") });
    }
    const sourceBytes = Buffer.byteLength(body.source, "utf8");
    if (sourceBytes > config.sourceBytes) {
      return reply.code(413).send({ error: structuredError("SOURCE_TOO_LARGE", "request", "Source exceeds 65,536 UTF-8 bytes") });
    }
    const errors = validator.validate("run-request.schema.json", body);
    if (errors.length > 0) {
      return reply.code(400).send({ error: structuredError("BAD_REQUEST", "request", errors.join("; ")) });
    }
    const runRequest = body as unknown as RunRequest;
    if (runRequest.engine === "jvm" && !existsSync(config.javaJarPath)) {
      return reply.code(503).send({ error: structuredError("ENGINE_UNAVAILABLE", "analysis", "Java analyzer JAR is not built") });
    }
    if (runRequest.engine === "custom" && !existsSync(config.runnerPath)) {
      return reply.code(503).send({ error: structuredError("ENGINE_UNAVAILABLE", "execute", "Custom gcd_runner executable is not available") });
    }
    if (
      runRequest.engine === "custom" &&
      ((runRequest.options?.custom?.regionSize ?? 0) !== 0 || (runRequest.options?.custom?.slotReuse ?? false))
    ) {
      return reply.code(503).send({ error: structuredError("ENGINE_UNAVAILABLE", "request", "This runner build does not support region-size or slot-reuse variants yet") });
    }
    if (activeRunId) {
      return reply.code(409).send({ error: structuredError("BUSY", "request", "Another engine operation is active") });
    }

    const runId = newRunId();
    const runDir = join(config.runRoot, runId);
    const createdAt = new Date().toISOString();
    const entry: StoredRun = {
      runDir,
      abort: new AbortController(),
      result: {
        schema: "gcd.run-result/1",
        runId,
        engine: runRequest.engine,
        language: runRequest.engine === "jvm" ? "java" : "gcd-toy",
        sourceSha256: "",
        createdAt,
        status: "running",
        phases: {},
        output: { stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false },
        errors: [],
        limits: emptyLimits(config, runRequest.engine, runRequest.source),
        toolVersions: { controller: "2.0.0", gitCommit: config.gitCommit }
      }
    };
    activeRunId = runId;
    runs.set(runId, entry);
    try {
      await mkdir(runDir, { mode: 0o700 });
      const sourceSha256 = createHash("sha256").update(runRequest.source, "utf8").digest("hex");
      entry.result.sourceSha256 = sourceSha256;
    } catch (error) {
      activeRunId = undefined;
      runs.delete(runId);
      request.log.error({ error }, "Unable to create run directory");
      return reply.code(500).send({ error: structuredError("INTERNAL", "controller", String(error)) });
    }

    const startedAt = new Date().toISOString();
    entry.completion = (async () => {
      try {
        let outcome: AdapterOutcome | Awaited<ReturnType<typeof executeCustom>>;
        if (runRequest.engine === "jvm") {
          outcome = await executeJava(config, runRequest, runDir, entry.abort.signal);
        } else {
          outcome = await executeCustom(config, runRequest, runId, runDir, entry.abort.signal);
        }
        const result = finalResult(config, entry, outcome, startedAt);
        const validationErrors = validator.validate("run-result.schema.json", result);
        if (validationErrors.length > 0) {
          request.log.error({ runId, validationErrors }, "Run result failed schema validation");
          result.status = "internal_error";
          result.errors = [
            ...result.errors,
            structuredError("SCHEMA_VIOLATION", "controller", validationErrors.join("; "))
          ];
        }
        entry.result = result;
        const resultPath = join(runDir, "run-result.json");
        const temporary = `${resultPath}.tmp`;
        await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, resultPath);
      } catch (error) {
        request.log.error({ runId, error }, "Run failed unexpectedly");
        entry.result = {
          ...entry.result,
          startedAt,
          endedAt: new Date().toISOString(),
          status: "internal_error",
          phases: {
            analysis: phase("failed", 0, "controller"),
            execute: phase("failed", 0, "controller")
          },
          output: { stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false },
          errors: [structuredError("INTERNAL", "controller", String(error))],
          staticAnalysis: fallbackAnalysis(runRequest.engine),
          engineResult: runRequest.engine === "jvm" ? emptyJvmResult(config) : emptyCustomResult(config)
        };
      } finally {
        activeRunId = undefined;
        await pruneRunRoot(config, runs);
      }
    })();
    return reply.code(202).send({ runId });
  });

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    const run = runs.get(request.params.id);
    return run ? reply.send(run.result) : reply.code(404).send({ error: "Run not found" });
  });

  app.post<{ Params: { id: string } }>("/api/runs/:id/cancel", async (request, reply) => {
    const run = runs.get(request.params.id);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    if (run.result.status !== "running") return reply.code(409).send({ error: "Run is already finished" });
    run.abort.abort();
    return reply.code(202).send({ runId: request.params.id, status: "cancelling" });
  });

  app.get("/api/benchmarks", async () => []);
  app.get("/api/runs/:id/trace", async (_request, reply) => reply.code(404).send({ error: "Trace API is not enabled in Phase 2" }));
  app.get("/api/runs/:id/snapshots/:index", async (_request, reply) => reply.code(404).send({ error: "Snapshot API is not enabled in Phase 2" }));
  app.get("/api/runs/:id/regions", async (_request, reply) => reply.code(404).send({ error: "Region API is not enabled in Phase 2" }));

  app.addHook("onClose", async () => {
    for (const run of runs.values()) {
      if (run.result.status === "running") run.abort.abort();
    }
    await Promise.all([...runs.values()].map((run) => run.completion).filter((item) => item !== undefined));
  });
  return app;
}

export async function startServer(config: Config = defaultConfig): Promise<FastifyInstance> {
  const app = await createServer(config);
  await app.listen({ host: config.host, port: config.port });
  return app;
}
