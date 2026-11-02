// Public/built deployments must never proxy the local operator secret.
const handle = () => Response.json({ detail: 'Label ใช้ได้ผ่าน start-dev.bat บนเครื่องผู้ดูแลเท่านั้น' }, { status: 503 });
export const GET = handle;
export const POST = handle;
export const PUT = handle;
