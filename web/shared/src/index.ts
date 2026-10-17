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
