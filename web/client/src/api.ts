import type { Engine, RunRequest, RunResult, Sample } from "@gcd/shared";

export interface ApiError {
  code: string;
  message: string;
}

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly error: ApiError) {
    super(error.message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const raw = (body as { error?: unknown } | null)?.error;
    const error: ApiError =
      typeof raw === "object" && raw !== null && "message" in raw
        ? (raw as ApiError)
        : { code: "HTTP_ERROR", message: typeof raw === "string" ? raw : `HTTP ${response.status}` };
    throw new ApiFailure(response.status, error);
  }
  return body as T;
}

const json = (payload: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload)
});

export interface Health {
  status: string;
  jdk: { found: boolean; version: string };
  customRunner: { found: boolean };
  javaAnalyzer: { found: boolean };
}

export const api = {
  health: () => request<Health>("/api/health"),
  samples: () => request<{ jvm: Sample[]; custom: Sample[] }>("/api/samples"),
  startRun: (engine: Engine, source: string) => {
    const body: RunRequest = { schema: "gcd.run-request/1", engine, source };
    return request<{ runId: string }>("/api/runs", json(body));
  },
  getRun: (runId: string) => request<RunResult>(`/api/runs/${runId}`),
  cancel: (runId: string) => request<unknown>(`/api/runs/${runId}/cancel`, json({}))
};
