/** A small, bounded same-origin mutation body; never logs session information. */
export async function parkingRequestBody(request: Request): Promise<unknown> {
  if (request.headers.get("origin") !== (process.env.PARKMAP_PUBLIC_ORIGIN ?? new URL(request.url).origin)) throw new Error("Origin");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw new Error("Body too large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
