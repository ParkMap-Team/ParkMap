import createClient from "openapi-fetch";
import type { paths } from "./schema.gen.ts";

/** Server-side client for the ParkMap API. PARKMAP_API_URL is never exposed to the browser. */
export function apiClient() {
  const baseUrl = process.env.PARKMAP_API_URL;
  if (!baseUrl) {
    throw new Error("PARKMAP_API_URL is not configured.");
  }
  return createClient<paths>({ baseUrl });
}

/** Status the LIFF app returns when the ParkMap API did not answer with data. */
export function upstreamFailureStatus(upstreamStatus: number): 404 | 502 | 503 {
  if (upstreamStatus === 404 || upstreamStatus === 422) return 404;
  if (upstreamStatus === 503) return 503;
  return 502;
}
