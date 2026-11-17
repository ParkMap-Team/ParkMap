import { cookies } from "next/headers";

export const VEHICLE_COOKIE = "parkmap_line_session";
export const TOKEN_TYPE_COOKIE = "parkmap_line_token_type";
export type Preference = { model_id: string | null; models: { id: string; label: string }[] };

export async function vehiclePreference(token?: string, model?: string, type?: "id" | "access"): Promise<Preference | null> {
  // Only next dev skips account verification. Builds and next start always use LINE.
  if (process.env.NODE_ENV === "development") {
    return { model_id: "other", models: [{ id: "other", label: "อื่นๆ (ทดสอบในเครื่อง)" }] };
  }
  const identity = token ?? (await cookies()).get(VEHICLE_COOKIE)?.value;
  if (!identity) return null;
  const tokenType = type ?? ((await cookies()).get(TOKEN_TYPE_COOKIE)?.value === "access" ? "access" : "id");
  const base = process.env.PARKMAP_SETTINGS_URL;
  if (!base) return null;
  try {
    const response = await fetch(new URL("/api/line/preferences", base), {
      method: model === undefined ? "GET" : "PUT", cache: "no-store",
      headers: { Authorization: "Bearer " + identity, "X-Line-Token-Type": tokenType, "Content-Type": "application/json" },
      ...(model === undefined ? {} : { body: JSON.stringify({ model_id: model }) }),
      signal: AbortSignal.timeout(10000),
    });
    return response.ok ? await response.json() as Preference : null;
  } catch { return null; }
}
