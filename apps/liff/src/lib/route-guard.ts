// Checks for the app's own JSON route handlers, which proxy to the LINE settings service.

/** True only for a request sent by this app's own pages. */
export function sameOrigin(request: Request): boolean {
  return request.headers.get("origin") === (process.env.PARKMAP_PUBLIC_ORIGIN ?? new URL(request.url).origin);
}

/** The request body as text; throws when it is missing or longer than 12000 bytes. */
export async function limitedBody(request: Request): Promise<string> {
  const reader = request.body?.getReader(); if (!reader) throw new Error("Empty body");
  let size = 0; const chunks: Uint8Array[] = [];
  try { for (;;) { const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > 12000) throw new Error("Body too large"); chunks.push(value);
  }} finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
}
