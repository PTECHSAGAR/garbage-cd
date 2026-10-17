#!/usr/bin/env bash
set -euo pipefail

runner=${1:?runner executable required}
baseline=${2:?baseline executable required}
repo=$(cd "$(dirname "$0")/../.." && pwd)
node_bin=${NODE:-node}

"$node_bin" - "$runner" "$baseline" "$repo" <<'NODE'
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const [runner, baseline, repo] = process.argv.slice(2);
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gcd-runner-tests-"));

function runCase(name, source, expectedExit, expectedCode = null) {
  const sourcePath = path.join(temporaryDirectory, `${name}.gcd`);
  const resultPath = path.join(temporaryDirectory, `${name}.json`);
  fs.writeFileSync(sourcePath, source);
  const child = spawnSync(runner, ["--source", sourcePath, "--result", resultPath], {
    encoding: "utf8",
  });
  assert.equal(child.signal, null, `${name} terminated by ${child.signal}`);
  assert.equal(child.status, expectedExit, `${name}: ${child.stderr}`);

  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  assert.equal(result.schema, "gcd.run-result/1");
  assert.match(result.runId, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  assert.equal(
    result.sourceSha256,
    crypto.createHash("sha256").update(source).digest("hex"),
  );
  if (expectedCode) {
    assert.equal(result.status, "program_error");
    assert.equal(result.errors[0].code, expectedCode);
  } else {
    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.errors, []);
  }
  return result;
}

try {
  const sampleSource = fs.readFileSync(path.join(repo, "examples/sample_program.txt"), "utf8");
  const sample = runCase("sample", sampleSource, 0);
  const baselineOutput = spawnSync(
    baseline,
    [path.join(repo, "examples/sample_program.txt")],
    { encoding: "utf8" },
  );
  assert.equal(baselineOutput.status, 0, baselineOutput.stderr);
  const reportValue = (label) => {
    const match = baselineOutput.stdout.match(new RegExp(`${label}:\\s+(\\d+)`));
    assert.ok(match, `baseline report missing ${label}`);
    return Number(match[1]);
  };
  assert.equal(sample.engineResult.totals.allocations.value, reportValue("total allocations so far"));
  assert.equal(sample.engineResult.totals.collections.value, reportValue("total collections so far"));
  assert.equal(sample.engineResult.collections[0].freed.value, reportValue("objects collected this run"));
  assert.equal(sample.engineResult.collections[0].liveAfter.value, reportValue("live objects after collection"));
  assert.equal(sample.engineResult.totals.allocations.value, 2);
  assert.equal(sample.engineResult.totals.collections.value, 1);
  assert.equal(sample.engineResult.totals.freed.value, 2);
  assert.equal(sample.engineResult.totals.liveAfter.value, 0);
  assert.match(sample.output.stdout, /gc\(\) called:/);
  assert.equal(sample.staticAnalysis.nodeCount, 12);

  const chain = runCase(
    "chain",
    "a = new Object(); b = new Object(); c = new Object(); a.next = b; b.next = c; a = null; gc();",
    0,
  );
  assert.equal(chain.engineResult.totals.freed.value, 1);
  assert.equal(chain.engineResult.totals.liveAfter.value, 2);

  const cycle = runCase(
    "cycle",
    "a = new Object(); b = new Object(); a.next = b; b.next = a; a = null; b = null; gc();",
    0,
  );
  assert.equal(cycle.engineResult.totals.freed.value, 2);

  runCase("runtime-error", "a = 5; a.f = null;", 2, "RUNTIME_ERROR");
  runCase("parse-error", "a = ;", 2, "PARSE_ERROR");
  runCase("lex-error", "// comment", 2, "LEX_ERROR");
  runCase("overflow-error", "a = 99999999999999999999;", 2, "RUNTIME_ERROR");
  const empty = runCase("empty", "", 0);
  assert.equal(empty.output.stdout, "");
  assert.equal(empty.engineResult.totals.allocations.value, 0);

  const located = runCase("runtime-span", "a = 5;\n  a.f = null;", 2, "RUNTIME_ERROR");
  assert.deepEqual(
    {
      line: located.errors[0].location.line,
      column: located.errors[0].location.column,
      endLine: located.errors[0].location.endLine,
      endColumn: located.errors[0].location.endColumn,
    },
    { line: 2, column: 3, endLine: 2, endColumn: 14 },
  );

  runCase("source-too-large", " ".repeat(65537), 2, "SOURCE_TOO_LARGE");

  const truncated = runCase("stdout-limit", "gc();".repeat(1000), 0);
  assert.equal(truncated.output.stdout.length, 65536);
  assert.equal(truncated.output.stdoutTruncated, true);

  const truncatedAst = runCase("ast-limit", "a=1;".repeat(3000), 0);
  assert.equal(truncatedAst.staticAnalysis.nodeCount, 5000);
  assert.equal(truncatedAst.staticAnalysis.truncated, true);

  const control = runCase("control-character", "a = \u0001;", 2, "LEX_ERROR");
  assert.ok(control.errors[0].message.includes("\u0001"));

  const usage = spawnSync(runner, ["--unknown"], { encoding: "utf8" });
  assert.equal(usage.status, 3);

  console.log("runner tests passed");
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
NODE
