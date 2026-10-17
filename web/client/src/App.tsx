import type { RunResult, RunStatus } from "@gcd/shared";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { api, ApiFailure } from "./api";
import { AstPanel } from "./components/AstPanel";
import { EditorPanel, type EditorCommand, type EditorDiagnostic } from "./components/EditorPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { OutputPanel, type Jump } from "./components/OutputPanel";
import { StatsPanel } from "./components/StatsPanel";
import { TopBar } from "./components/TopBar";
import { initialState, isActive, reducer } from "./store";
import { useRunPolling } from "./usePolling";

function offsetOf(source: string, line: number, column: number): number {
  const lines = source.split("\n");
  let offset = 0;
  for (let index = 0; index < Math.min(line - 1, lines.length); index++) offset += lines[index]!.length + 1;
  return Math.min(offset + Math.max(column - 1, 0), source.length);
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [leftTab, setLeftTab] = useState<"ast" | "stats">("ast");
  const [command, setCommand] = useState<EditorCommand | null>(null);
  const source = state.sources[state.engine];
  const active = isActive(state.run, state.runId);
  const status: RunStatus | "idle" = state.run?.status ?? (state.runId ? "running" : "idle");

  useEffect(() => {
    api
      .samples()
      .then((samples) => dispatch({ type: "samples", samples }))
      .catch((error: unknown) => dispatch({ type: "failed", message: String(error) }));
  }, []);

  const onProgress = useCallback((run: RunResult) => dispatch({ type: "progress", run }), []);
  const onPollError = useCallback((message: string) => dispatch({ type: "failed", message }), []);
  useRunPolling(state.runId, onProgress, onPollError);

  const jump = useCallback(
    (target: Jump) => {
      const start = offsetOf(source, target.line, target.column);
      const end =
        target.endLine && target.endColumn ? offsetOf(source, target.endLine, target.endColumn) : start;
      setCommand((previous) => ({ seq: (previous?.seq ?? 0) + 1, kind: "jump", start, end }));
    },
    [source]
  );

  // A finished run with a located error moves the cursor to it.
  const finishedId = state.run && state.run.status !== "running" && state.run.status !== "queued" ? state.run.runId : null;
  useEffect(() => {
    if (!state.run || !finishedId) return;
    const located =
      state.run.errors.find((error) => error.location)?.location ??
      state.run.staticAnalysis?.diagnostics.find((diagnostic) => diagnostic.severity === "error" && diagnostic.location)
        ?.location;
    if (located) jump(located);
  }, [finishedId]);

  const diagnostics = useMemo<EditorDiagnostic[]>(() => {
    const items: EditorDiagnostic[] = [];
    for (const diagnostic of state.run?.staticAnalysis?.diagnostics ?? []) {
      if (diagnostic.location && diagnostic.severity !== "note") {
        items.push({ line: diagnostic.location.line, severity: diagnostic.severity });
      }
    }
    for (const error of state.run?.errors ?? []) {
      if (error.location) items.push({ line: error.location.line, severity: "error" });
    }
    return items;
  }, [state.run]);

  const run = async () => {
    try {
      const { runId } = await api.startRun(state.engine, source);
      dispatch({ type: "started", runId });
    } catch (error) {
      dispatch({ type: "failed", message: error instanceof ApiFailure ? `${error.error.code}: ${error.message}` : String(error) });
    }
  };
  const stop = async () => {
    if (!state.runId) return;
    try {
      await api.cancel(state.runId);
    } catch (error) {
      dispatch({ type: "failed", message: String(error) });
    }
  };

  return (
    <div className="app">
      <TopBar
        engine={state.engine}
        samples={state.samples[state.engine]}
        sampleName={state.sampleName}
        status={status}
        runId={state.runId}
        onEngine={(engine) => dispatch({ type: "engine", engine })}
        onSample={(name) => dispatch({ type: "sample", name })}
        onRun={run}
        onStop={stop}
        onReset={() => dispatch({ type: "reset" })}
      />
      {state.requestError ? (
        <div className="banner" role="alert">
          {state.requestError}
        </div>
      ) : null}
      <PanelGroup direction="vertical" autoSaveId="gcd-main">
        <Panel defaultSize={68} minSize={25}>
          <PanelGroup direction="horizontal" autoSaveId="gcd-top">
            <Panel defaultSize={50} minSize={20}>
              <ErrorBoundary label="editor">
                <EditorPanel
                  source={source}
                  language={state.engine === "jvm" ? "java" : "gcd-toy"}
                  diagnostics={diagnostics}
                  command={command}
                  readOnly={active}
                  onChange={(value) => dispatch({ type: "edit", source: value })}
                />
              </ErrorBoundary>
            </Panel>
            <PanelResizeHandle className="handle" />
            <Panel defaultSize={50} minSize={20}>
              <div className="tabs" role="tablist">
                <button role="tab" aria-selected={leftTab === "ast"} onClick={() => setLeftTab("ast")}>
                  AST
                </button>
                <button role="tab" aria-selected={leftTab === "stats"} onClick={() => setLeftTab("stats")}>
                  Statistics
                </button>
              </div>
              <div className="tab-body">
                <ErrorBoundary label={leftTab === "ast" ? "AST" : "statistics"}>
                  {leftTab === "ast" ? (
                    <AstPanel
                      analysis={state.run?.staticAnalysis}
                      onSelectSpan={(span) =>
                        setCommand((previous) => ({ seq: (previous?.seq ?? 0) + 1, kind: "highlight", ...span }))
                      }
                    />
                  ) : (
                    <StatsPanel run={state.run} />
                  )}
                </ErrorBoundary>
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className="handle horizontal" />
        <Panel defaultSize={32} minSize={10}>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected="true">
              Output
            </button>
          </div>
          <div className="tab-body">
            <ErrorBoundary label="output">
              <OutputPanel run={state.run} onJump={jump} />
            </ErrorBoundary>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
