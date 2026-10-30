// Authoring runs only in Vite's loopback-bound Node dev middleware. A built
// workerd/public deployment must never become an unauthenticated token proxy.
function handle() {
  return Response.json({ detail: 'หน้าแก้แผนผังใช้ได้เฉพาะ dev บนเครื่องผู้ดูแล กรุณาเปิดด้วย start-dev.bat' }, {
    status: 503, headers: { 'Cache-Control': 'no-store' },
  });
}

export const GET = handle;
export const PUT = handle;
export const POST = handle;
