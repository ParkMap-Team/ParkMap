// Local operator credentials are available only in the loopback Vite proxy.
const handle = () => Response.json({ detail: 'ทดสอบ classifier ผ่าน start-dev.bat บนเครื่องผู้ดูแลเท่านั้น' }, { status: 503 });
export const GET = handle;
export const POST = handle;
