import { cookies } from "next/headers";
import type { ParkedSpot, ParkedSpotInput } from "./parked-spot";

export const VEHICLE_COOKIE = "parkmap_line_session";
export const TOKEN_TYPE_COOKIE = "parkmap_line_token_type";
export type Preference = { model_id: string | null; models: { id: string; label: string }[] };

/** Calls the LINE settings service as the session's LINE account; null without a session or on any failure. */
async function settingsRequest<T>(path: string, method: "GET" | "PUT" | "DELETE", body?: unknown, token?: string, type?: "id" | "access"): Promise<T | null> {
  const identity = token ?? (await cookies()).get(VEHICLE_COOKIE)?.value;
  if (!identity) return null;
  const tokenType = type ?? ((await cookies()).get(TOKEN_TYPE_COOKIE)?.value === "access" ? "access" : "id");
  const base = process.env.PARKMAP_SETTINGS_URL;
  if (!base) return null;
  try {
    const response = await fetch(new URL(path, base), {
      method, cache: "no-store",
      headers: { Authorization: "Bearer " + identity, "X-Line-Token-Type": tokenType, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    return response.ok ? await response.json() as T : null;
  } catch { return null; }
}

export async function vehiclePreference(token?: string, model?: string, type?: "id" | "access"): Promise<Preference | null> {
  return settingsRequest<Preference>("/api/line/preferences", model === undefined ? "GET" : "PUT",
    model === undefined ? undefined : { model_id: model }, token, type);
}

/** The session account's marked spot (ADR 0021): reads it, replaces it with `spot`, or erases it. */
export async function parkedSpot(change?: ParkedSpotInput | "erase"): Promise<{ spot: ParkedSpot | null } | null> {
  return settingsRequest("/api/line/parked-spot", change === undefined ? "GET" : change === "erase" ? "DELETE" : "PUT",
    change === undefined || change === "erase" ? undefined : change);
}
