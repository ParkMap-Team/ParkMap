// Server-only local operator proxy. Secrets never reach the browser or worker bindings.
import type { ProxyOptions } from './lotModelProxy.ts';

const reply = (status: number, detail: string) => Response.json({ detail }, { status });

export async function proxyAnnotationRequest(request: Request, options: ProxyOptions): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return reply(403, 'ไม่อนุญาตให้เว็บไซต์อื่นอ่านภาพส่วนตัว');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || (origin && origin !== url.origin) || (request.method !== 'GET' && !origin)) return reply(403, 'ใช้ได้จากเครื่องผู้ดูแลและ origin เดียวกันเท่านั้น');
  if (!options.token) return reply(503, 'เปิดบริการผ่าน start-dev.bat เพื่อใช้ Label');
  const dataset = url.searchParams.get('dataset') ?? '';
  const classifier = url.pathname === '/api/classifier';
  const id = url.searchParams.get('id') ?? '';
  if (!classifier && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(dataset)) return reply(400, 'ชื่อชุดข้อมูลใช้ a-z, 0-9 และขีดกลาง ไม่เกิน 63 ตัว');
  const operation = url.searchParams.get('op');
  if (['image', 'save', 'detect'].includes(operation ?? '') && !/^[a-f0-9]{64}$/.test(id)) return reply(400, 'รหัสภาพไม่ถูกต้อง');
  const root = `/api/operator/annotations/${dataset}`;
  const routes: Record<string, string> = {
    'GET:samples': root, 'POST:upload': `${root}/images`, 'GET:image': `${root}/images/${id}`,
    'PUT:save': `${root}/samples/${id}`, 'POST:detect': `${root}/samples/${id}/detect`, 'POST:export': `${root}/export`,
  };
  const classifierRoutes: Record<string, string> = { 'GET:models': '/api/operator/classifier/models', 'POST:predict': '/api/operator/classifier/predict' };
  const path = (classifier ? classifierRoutes : routes)[`${request.method}:${operation}`];
  if (!path) return reply(405, 'คำสั่งไม่รองรับ');
  const type = request.headers.get('Content-Type') ?? '';
  if (['upload', 'predict'].includes(operation ?? '') && !type.startsWith('multipart/form-data;')) return reply(415, 'ส่งรูปด้วย multipart/form-data');
  if (operation === 'save' && type.split(';')[0].trim() !== 'application/json') return reply(415, 'ส่ง label เป็น JSON');
  const limit = ['upload', 'predict'].includes(operation ?? '') ? 26 * 1024 * 1024 : 1024 * 1024;
  if (Number(request.headers.get('Content-Length')) > limit) return reply(413, 'ข้อมูลใหญ่เกินกำหนด');
  try {
    let body: ArrayBuffer | undefined;
    if (request.method !== 'GET') {
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = []; let length = 0;
      try {
        if (reader) while (true) {
          const part = await reader.read(); if (part.done) break;
          length += part.value.byteLength;
          if (length > limit) { await reader.cancel(); return reply(413, 'ข้อมูลใหญ่เกินกำหนด'); }
          chunks.push(part.value);
        }
      } finally { reader?.releaseLock(); }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      body = bytes.buffer;
    }
    const response = await (options.fetcher ?? fetch)(options.apiUrl.replace(/\/$/, '') + path, {
      method: request.method, body, cache: 'no-store', signal: AbortSignal.timeout(['detect', 'predict'].includes(operation ?? '') ? 120_000 : 30_000),
      headers: { Authorization: `Bearer ${options.token}`, ...(type ? { 'Content-Type': type } : {}) },
    });
    return new Response(await response.arrayBuffer(), { status: response.status, headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': 'no-store',
    } });
  } catch { return reply(502, 'ติดต่อ Vision API ไม่ได้ กรุณาตรวจหน้าต่าง API'); }
}
