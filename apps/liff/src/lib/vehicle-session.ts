import { cookies } from "next/headers";

export const VEHICLE_COOKIE = "parkmap_line_session";
export type Preference = { model_id: string | null; models: { id: string; label: string }[] };

export async function vehiclePreference(token?: string, model?: string): Promise<Preference | null> {
  const identity = token ?? (await cookies()).get(VEHICLE_COOKIE)?.value;
  if (!identity) return null;
  const base = process.env.PARKMAP_SETTINGS_URL;
  if (!base) return null;
  try {
    const response = await fetch(new URL("/api/line/preferences", base), {
      method: model === undefined ? "GET" : "PUT", cache: "no-store",
      headers: { Authorization: "Bearer " + identity, "Content-Type": "application/json" },
      ...(model === undefined ? {} : { body: JSON.stringify({ model_id: model }) }),
      signal: AbortSignal.timeout(10000),
    });
    return response.ok ? await response.json() as Preference : null;
  } catch { return null; }
}
