// Which map view is on screen. 3D is the default; 2D shows the same geometry and statuses and takes
// over at once when WebGL is missing, when 3D fails, or when 3D is not ready within the time limit.
// There is no frame-rate trigger. People can switch either way, and retry 3D unless WebGL is missing.

export const THREE_D_TIMEOUT_MS = 10_000;

export type RendererMode = "2d" | "3d";
export type ThreeDStatus = "checking" | "loading" | "ready" | "unavailable" | "timed-out" | "failed";
export type RendererState = { mode: RendererMode; status3d: ThreeDStatus };

export type RendererEvent =
  | { type: "webgl"; available: boolean }
  | { type: "ready" }
  | { type: "timeout" }
  | { type: "failed" }
  | { type: "choose"; mode: RendererMode };

export const INITIAL_RENDERER: RendererState = { mode: "3d", status3d: "checking" };

export function rendererReducer(state: RendererState, event: RendererEvent): RendererState {
  switch (event.type) {
    case "webgl":
      if (state.status3d !== "checking") return state;
      return event.available ? { ...state, status3d: "loading" } : { mode: "2d", status3d: "unavailable" };
    case "ready":
      return state.status3d === "loading" ? { ...state, status3d: "ready" } : state;
    case "timeout":
      return state.status3d === "loading" && state.mode === "3d" ? { mode: "2d", status3d: "timed-out" } : state;
    case "failed":
      return state.status3d === "unavailable" ? state : { mode: "2d", status3d: "failed" };
    case "choose":
      if (event.mode === "2d") return { ...state, mode: "2d" };
      if (state.status3d === "unavailable" || state.status3d === "checking") return state;
      // Retrying after a timeout or failure loads 3D again from the start.
      return { mode: "3d", status3d: state.status3d === "ready" ? "ready" : "loading" };
  }
}

/** Whether the 3D canvas should be mounted: while it loads or is shown. */
export function mountsThreeD(state: RendererState): boolean {
  return state.mode === "3d" && (state.status3d === "loading" || state.status3d === "ready");
}

export const FALLBACK_NOTICES: Partial<Record<ThreeDStatus, string>> = {
  unavailable: "อุปกรณ์นี้แสดงแผนที่ 3 มิติไม่ได้ จึงแสดงแบบ 2 มิติ",
  "timed-out": "แผนที่ 3 มิติโหลดช้า จึงแสดงแบบ 2 มิติ",
  failed: "โหลดแผนที่ 3 มิติไม่สำเร็จ จึงแสดงแบบ 2 มิติ",
};

/** WebGL support without keeping a context alive. */
export function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return context !== null;
  } catch {
    return false;
  }
}
