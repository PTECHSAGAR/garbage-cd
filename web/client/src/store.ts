import type { Engine, RunResult, Sample } from "@gcd/shared";
import type { CustomOptions } from "./api";

export interface State {
  engine: Engine;
  samples: { jvm: Sample[]; custom: Sample[] };
  sampleName: string;
  sources: Record<Engine, string>;
  runId: string | null;
  run: RunResult | null;
  requestError: string | null;
  customOptions: CustomOptions;
  /** Finished runs of this session, newest last, for the Compare tab. */
  history: RunResult[];
}

export type Action =
  | { type: "samples"; samples: State["samples"] }
  | { type: "engine"; engine: Engine }
  | { type: "sample"; name: string }
  | { type: "edit"; source: string }
  | { type: "started"; runId: string }
  | { type: "progress"; run: RunResult }
  | { type: "failed"; message: string }
  | { type: "options"; options: Partial<CustomOptions> }
  | { type: "reset" };

export const initialState: State = {
  engine: "jvm",
  samples: { jvm: [], custom: [] },
  sampleName: "",
  sources: { jvm: "", custom: "" },
  runId: null,
  run: null,
  requestError: null,
  customOptions: { regionSize: 0, slotReuse: false },
  history: []
};

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "samples": {
      const first = action.samples[state.engine][0];
      return {
        ...state,
        samples: action.samples,
        sampleName: first?.name ?? "",
        sources: {
          jvm: action.samples.jvm[0]?.source ?? "",
          custom: action.samples.custom[0]?.source ?? ""
        }
      };
    }
    case "engine": {
      const first = state.samples[action.engine][0];
      return {
        ...state,
        engine: action.engine,
        sampleName: first?.name ?? "",
        sources: { ...state.sources, [action.engine]: first?.source ?? state.sources[action.engine] },
        run: null,
        runId: null,
        requestError: null
      };
    }
    case "sample": {
      const sample = state.samples[state.engine].find((item) => item.name === action.name);
      if (!sample) return { ...state, sampleName: "" };
      return { ...state, sampleName: sample.name, sources: { ...state.sources, [state.engine]: sample.source } };
    }
    case "edit":
      if (action.source === state.sources[state.engine]) return state;
      return { ...state, sampleName: "", sources: { ...state.sources, [state.engine]: action.source } };
    case "started":
      return { ...state, runId: action.runId, run: null, requestError: null };
    case "progress": {
      if (action.run.runId !== state.runId) return state;
      const finished = action.run.status !== "running" && action.run.status !== "queued";
      const history =
        finished && !state.history.some((item) => item.runId === action.run.runId)
          ? [...state.history, action.run].slice(-10)
          : state.history;
      return { ...state, run: action.run, history };
    }
    case "failed":
      return { ...state, requestError: action.message };
    case "options":
      return { ...state, customOptions: { ...state.customOptions, ...action.options } };
    case "reset":
      return { ...state, run: null, runId: null, requestError: null };
  }
}

export const isActive = (run: RunResult | null, runId: string | null): boolean =>
  runId !== null && (run === null || run.status === "running" || run.status === "queued");
