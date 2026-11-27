import type { MetricPoint } from "../api/types";

export type SelectedReservation = { target: MetricPoint; parking_area_id: string; observed_at: string; lot_model_version: number };

/** Validate transport only; Python still decides whether this point can be held. */
export function selectedReservationInput(value: unknown): SelectedReservation | null {
  if (!value || typeof value !== "object") return null;
  const { target, parking_area_id, observed_at, lot_model_version } = value as Record<string, unknown>;
  if (!target || typeof target !== "object" || Array.isArray(target)) return null;
  const { x_m, y_m } = target as Record<string, unknown>;
  if (typeof x_m !== "number" || typeof y_m !== "number" || !Number.isFinite(x_m) || !Number.isFinite(y_m)
      || Math.abs(x_m) > 10_000 || Math.abs(y_m) > 10_000) return null;
  if (typeof parking_area_id !== "string" || !parking_area_id || parking_area_id.length > 128) return null;
  if (typeof observed_at !== "string" || !Number.isFinite(Date.parse(observed_at))) return null;
  if (typeof lot_model_version !== "number" || !Number.isSafeInteger(lot_model_version) || lot_model_version < 1) return null;
  return { target: { x_m, y_m }, parking_area_id, observed_at, lot_model_version };
}
