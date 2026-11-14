import { proxyMobileCamera } from '@/lib/mobile-camera-proxy';

export const dynamic = 'force-dynamic';
const handle = (request: Request) => proxyMobileCamera(request, {
  apiUrl: process.env.PARKMAP_API_URL ?? 'http://127.0.0.1:8000',
});
export const GET = handle;
export const POST = handle;
