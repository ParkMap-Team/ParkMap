import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { proxyLotModelRequest, type ProxyOptions } from './lotModelProxy.ts';

/** Keep the local operator secret in Vite's Node process, outside the workerd client/runtime bindings. */
export function lotModelEditorDevProxy(options: ProxyOptions): Plugin {
  return {
    name: 'parkmap-local-lot-model-editor',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(lotModelEditorMiddleware(options));
    },
  };
}

export function lotModelEditorMiddleware(options: ProxyOptions) {
  return (incoming: IncomingMessage, outgoing: ServerResponse, next: () => void) => {
    if (incoming.url?.split('?')[0] !== '/api/lot-model-editor') { next(); return; }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (value !== undefined) for (const part of Array.isArray(value) ? value : [value]) headers.append(key, part);
    }
    void (async () => {
      const init: RequestInit & { duplex?: string } = { method: incoming.method, headers };
      if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
        init.body = Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>;
        init.duplex = 'half';
      }
      const request = new Request(new URL(incoming.url ?? '/', `http://${headers.get('Host') ?? '127.0.0.1:3000'}`), init);
      const response = await proxyLotModelRequest(request, options);
      outgoing.statusCode = response.status;
      response.headers.forEach((value, name) => outgoing.setHeader(name, value));
      outgoing.end(new Uint8Array(await response.arrayBuffer()));
    })().catch(() => {
      if (outgoing.headersSent || outgoing.destroyed) { outgoing.end(); return; }
      outgoing.statusCode = 502; outgoing.setHeader('Content-Type', 'application/json');
      outgoing.end(JSON.stringify({ detail: 'ติดต่อระบบแก้แผนผังไม่ได้ กรุณาตรวจหน้าต่าง Calibration UI' }));
    });
  };
}
