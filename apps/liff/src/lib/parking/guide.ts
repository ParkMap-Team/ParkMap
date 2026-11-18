import { isKnownFamily } from "./guard-booth.ts";

/**
 * Where a parking-guide request stands on the map. The API picks the place from the model saved with
 * the student's LINE account and holds it, shared with the Guard Booth; this only names the answer.
 */
export type GuideStatus =
  | "unavailable" | "unsupported-model" | "unverified-model" | "searching" | "failed"
  | "no-fit" | "found" | "confirming" | "parked" | "released";

export function guideStatus({ enabled, loading, recordedFrame, family, preferenceError, failed, requested, answer, held, expired }: {
  /** The recommendation endpoint serves this site. */
  enabled: boolean;
  /** The parking state has not arrived yet, so whether a recorded photo exists is not known. */
  loading: boolean;
  /** A current recorded photo exists; a place is never recommended without one. */
  recordedFrame: boolean;
  /** The model the server has for this LINE account; `undefined` until it has answered. */
  family: string | null | undefined;
  preferenceError: boolean;
  /** The recommendation or the shared hold ledger could not be read. */
  failed: boolean;
  requested: boolean;
  /** The latest answer for this request, if any. */
  answer: { stage?: string | null; polygon?: unknown } | null | undefined;
  /** The answer's place is held on the current photo and the ledger agrees. */
  held: boolean;
  /** The answer's hold time has passed on this clock. */
  expired: boolean;
}): GuideStatus {
  if (!enabled) return "unavailable";
  if (loading) return "searching";
  if (!recordedFrame) return "unavailable";
  if (preferenceError) return "unverified-model";
  if (family === undefined) return "searching";
  if (!family || !isKnownFamily(family)) return "unsupported-model";
  if (failed) return "failed";
  if (answer?.stage === "OCCUPIED_CONFIRMED") return "parked";
  if (answer?.stage === "AWAITING_CONFIRMATION") return "confirming";
  if (answer?.stage === "RELEASED") return "released";
  if (held) return "found";
  if (!requested || !answer) return "searching";
  if (!answer.polygon) return "no-fit";
  // A held place whose time is up waits for a new photo; any other place is on its way to this photo.
  return expired ? "confirming" : "searching";
}
