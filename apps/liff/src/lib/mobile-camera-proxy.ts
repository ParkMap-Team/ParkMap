// Public phone capabilities only. This proxy never reads an editor/worker token.
export async function proxyMobileCamera(request: Request, options: {
  apiUrl: string; fetcher?: typeof fetch;
}) {
  const operation = new URL(request.url).searchParams.get('op') ?? '';
  if (!['POST:claim', 'POST:frame', 'GET:status', 'POST:stop'].includes(`${request.method}:${operation}`)) {
    return Response.json({ detail: 'Unsupported camera operation' }, { status: 405 });
  }
  const limit = operation === 'frame' ? 8 * 1024 * 1024 : 2048;
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = request.body?.getReader();
  if (reader) {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > limit) {
        await reader.cancel();
        return Response.json({ detail: 'Camera request too large' }, { status: 413 });
      }
      chunks.push(part.value);
    }
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  const headers = new Headers();
  for (const key of ['Authorization', 'Content-Type', 'X-Frame-Sequence']) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  try {
    const upstream = await (options.fetcher ?? fetch)(`${options.apiUrl.replace(/\/$/, '')}/api/mobile-camera/${operation}`, {
      method: request.method, headers, body: request.method === 'GET' ? undefined : body,
      cache: 'no-store', signal: AbortSignal.timeout(25_000),
    });
    return Response.json(await upstream.json(), { status: upstream.status,
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch {
    return Response.json({ detail: 'Camera API unavailable; try again' }, { status: 502 });
  }
}
