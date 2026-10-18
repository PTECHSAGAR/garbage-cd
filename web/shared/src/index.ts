export type Engine = "jvm" | "custom";
export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "compile_error"
  | "program_error"
  | "timeout"
  | "output_limit"
  | "resource_limit"
  | "cancelled"
  | "internal_error";
export type TraceLevel = "off" | "gc" | "mutator" | "full";
export type Collector = "serial" | "g1";
export type Provenance = "measured" | "estimated" | "reconstructed" | "unavailable";

export interface RunRequest {
  schema: "gcd.run-request/1";
  engine: Engine;
  source: string;
  options?: {
    jvm?: {
      collector?: Collector;
      heapMiB?: number;
      timeoutMs?: number;
    };
    custom?: {
      traceLevel?: TraceLevel;
      batchSize?: number;
      snapshots?: boolean;
      regionSize?: 0 | 16 | 32 | 64 | 128 | 256;
      slotReuse?: boolean;
    };
  };
}

export interface Metric {
  value: number | null;
  unit: string;
  provenance: Provenance;
  source: string;
  note?: string;
}

export interface StructuredError {
  code: string;
  phase: "request" | "analysis" | "compile" | "execute" | "controller";
  message: string;
  location?: {
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
    startOffset?: number;
    endOffset?: number;
    provenance: "compiler" | "derived";
  };
  detail?: {
    exceptionClass?: string;
    stackTop?: string[];
  };
}

export interface StaticAnalysisResult {
  schema: "gcd.static-analysis/1";
  language: "java" | "gcd-toy";
  ast: AstNode | null;
  nodeCount: number;
  truncated: boolean;
  diagnostics: Array<{
    severity: "error" | "warning" | "note";
    code: string;
    message: string;
    location?: StructuredError["location"];
  }>;
  java?: {
    mainClass: string | null;
    publicTypeName: string | null;
    packageName: string | null;
    compileMs: Metric;
  };
}

export interface AstNode {
  id: number;
  kind: string;
  label?: string;
  synthetic?: boolean;
  span?: {
    start: number;
    end: number;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
    provenance: "compiler" | "derived";
  };
  children: AstNode[];
}

export interface RunResult {
  schema: "gcd.run-result/1";
  runId: string;
  engine: Engine;
  language: "java" | "gcd-toy";
  sourceSha256: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  status: RunStatus;
  phases: {
    analysis?: PhaseInfo;
    compile?: PhaseInfo;
    execute?: PhaseInfo;
  };
  output: {
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  };
  errors: StructuredError[];
  staticAnalysis?: StaticAnalysisResult;
  engineResult?: Record<string, unknown>;
  trace?: {
    available: boolean;
    complete: boolean;
    eventCount: number;
    droppedCount: number;
    batchCount: number;
  };
  limits: Record<string, number | string | null>;
  toolVersions: Record<string, string>;
}

export interface PhaseInfo {
  status: "ok" | "failed" | "skipped" | "killed";
  durationMs: Metric;
  exitCode?: number;
  signal?: string;
}

export interface Sample {
  engine: Engine;
  name: string;
  source: string;
}

export interface SnapshotObject {
  id: string;
  slot: number;
  generation: number;
  region: number | null;
  allocSeq: number;
  allocStatement: number;
  /** null for program-end snapshots, where no mark phase ran. */
  marked: boolean | null;
  fields: Array<{ name: string; target: string | null }>;
  discoveredBy?: { parent: string | null; field: string | null; root: string | null };
}

export interface HeapSnapshot {
  schema: "gcd.heap-snapshot/1";
  runId: string;
  index: number;
  point: "mark_complete" | "program_end";
  gcIndex: number | null;
  statementIndex: number;
  totalObjects: number;
  totalEdges: number;
  truncated: boolean;
  roots: Array<{ name: string; target: string }>;
  objects: SnapshotObject[];
}

export interface SnapshotIndexEntry {
  index: number;
  gcIndex: number | null;
  point: "mark_complete" | "program_end";
  objectCount: number;
  truncated: boolean;
}

/** `[seq, kind, statementIndex, ...args]` as defined by D.9. */
export type TraceEvent = [number, string, number, ...unknown[]];

export interface TraceBatch {
  schema: "gcd.trace-batch/1";
  runId: string;
  batch: number;
  firstSeq: number;
  lastSeq: number;
  droppedTotal: number;
  strings: Record<string, string>;
  events: TraceEvent[];
}

export interface TracePage {
  batches: TraceBatch[];
  next: number | null;
  trailer: { type: "end"; lastSeq: number; complete: boolean; droppedByKind?: Record<string, number> } | null;
}

export const MAX_SNAPSHOT_OBJECTS = 2_000;
