// Server-only request boundary. Never import this module into a client component.
const MAX_BYTES = 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const reply = (status: number, detail: string) => Response.json({ detail }, { status, headers: { 'Cache-Control': 'no-store' } });

export interface ProxyOptions {
  apiUrl: string;
  token?: string;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}

async function boundedBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return null; }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

export async function proxyLotModelRequest(request: Request, options: ProxyOptions): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (!LOCAL_HOSTS.has(url.hostname) || (origin && origin !== url.origin) || (request.method !== 'GET' && !origin)) {
    return reply(403, 'หน้าแก้แผนผังใช้ได้จากเครื่องผู้ดูแลและ origin เดียวกันเท่านั้น');
  }
  if (!options.token) return reply(503, 'ยังไม่ได้เปิดระบบแก้แผนผัง กรุณาเปิดบริการผ่าน start-dev.bat ใหม่');
  const operation = url.searchParams.get('op');
  const site = url.searchParams.get('site') ?? '';
  const siteOperations = ['draft', 'activate', 'active'];
  if (operation && siteOperations.includes(operation) && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(site)) {
    return reply(400, 'รหัสสถานที่ไม่ถูกต้อง');
  }
  const routes: Record<string, string> = {
    'GET:template': '/api/operator/lot-model/template',
    'GET:sites': '/api/sites',
    'GET:active': `/api/sites/${site}/lot-model`,
    'GET:draft': `/api/operator/lot-model/sites/${site}/draft`,
    'PUT:draft': `/api/operator/lot-model/sites/${site}/draft`,
    'POST:activate': `/api/operator/lot-model/sites/${site}/activate`,
    'POST:validate': '/api/operator/lot-model/validate',
  };
  const path = routes[`${request.method}:${operation}`];
  if (!path) return reply(405, 'คำสั่งนี้ไม่รองรับ');
  if (request.method !== 'GET' && request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return reply(415, 'ส่งข้อมูลเป็น JSON เท่านั้น');
  }
  try {
    const body = request.method === 'GET' ? undefined : await boundedBody(request);
    if (body === null) return reply(413, 'ไฟล์แผนผังต้องมีขนาดไม่เกิน 1 MB');
    const upstream = await (options.fetcher ?? fetch)(`${options.apiUrl.replace(/\/$/, '')}${path}`, {
      method: request.method, body, cache: 'no-store', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
    });
    return Response.json(await upstream.json(), { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return reply(502, 'ติดต่อ Vision API ไม่ได้ กรุณาตรวจหน้าต่าง API แล้วลองอีกครั้ง');
  }
}
