'use client';

import { useEffect, useRef, useState } from 'react';
import { matchesCameraAspect, openMatchingCamera } from '../lib/mobile-camera-format';

type State = { state: string; reference_image: { width: number; height: number }; remaining_s?: number; result_age_s?: number; freshness_limit_s?: number;
  result?: { cars: number; green_count: number; processed_at: string; image_regions: { kind: string; rings: number[][][] }[] } | null };
const labels: Record<string, string> = { AWAITING_PREVIEW: 'กำลังส่งภาพตัวอย่าง', AWAITING_APPROVAL: 'รอผู้ดูแลตรวจมุมและยืนยันบนคอม', LIVE: 'กำลังวิเคราะห์กล้องมือถือ', STOPPED: 'หยุดกล้องแล้ว' };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function MobileCamera() {
  const video = useRef<HTMLVideoElement>(null);
  const media = useRef<MediaStream | null>(null);
  const pair = useRef(''), token = useRef(''), running = useRef(false), phase = useRef(''), sequence = useRef(0);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [ready, setReady] = useState(false), [active, setActive] = useState(false);
  const [status, setStatus] = useState<State | null>(null), [error, setError] = useState('');
  const [now, setNow] = useState(0), [receivedAt, setReceivedAt] = useState(0);
  const fresh = !!status?.result && (status.result_age_s ?? 0)+Math.max(0, now-receivedAt)/1000 <= (status.freshness_limit_s ?? 15);

  async function stop() {
    generation.current++;
    running.current = false;
    controller.current?.abort();
    media.current?.getTracks().forEach(track => track.stop());
    media.current = null;
    if (token.current) {
      void fetch('/api/mobile-camera?op=stop', { method: 'POST', headers: { Authorization: `Bearer ${token.current}` }, keepalive: true }).catch(() => {});
    }
    token.current = '';
    setActive(false); setStatus(old => old ? { ...old, state: 'STOPPED', result: undefined } : old);
  }

  useEffect(() => {
    const readPair = () => {
      if (running.current) return;
      const next = new URLSearchParams(location.hash.slice(1)).get('pair');
      if (next) { pair.current = next; sequence.current = 0; setReady(true); setError(''); }
    };
    readPair();
    const hide = () => { if (document.hidden) void stop(); };
    const leave = () => { void stop(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    window.addEventListener('hashchange', readPair);
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', leave);
      clearInterval(timer);
      window.removeEventListener('hashchange', readPair);
      running.current = false; controller.current?.abort(); media.current?.getTracks().forEach(track => track.stop()); };
  }, []);

  async function call(operation: string, body?: BodyInit, contentType?: string) {
    const response = await fetch(`/api/mobile-camera?op=${operation}`, {
      method: operation === 'status' ? 'GET' : 'POST', signal: controller.current?.signal,
      headers: { ...(token.current ? { Authorization: `Bearer ${token.current}` } : {}),
        ...(contentType ? { 'Content-Type': contentType } : {}),
        ...(operation === 'frame' ? { 'X-Frame-Sequence': String(sequence.current++) } : {}) }, body,
    });
    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 429 || response.status === 502 || (response.status === 409 && typeof payload.detail === 'string' && payload.detail.startsWith('Analysis took too long'))) return null;
      throw new Error(typeof payload.detail === 'string' ? payload.detail : 'ส่งภาพไม่สำเร็จ');
    }
    return payload;
  }

  async function start() {
    if (running.current) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setError('ต้องเปิดผ่าน HTTPS และใช้ Safari/Chrome ที่อนุญาตกล้อง'); return; }
    running.current = true;
    const current = ++generation.current;
    history.replaceState(history.state, '', location.pathname);
    setError(''); setActive(true); controller.current = new AbortController();
    try {
      const claimed = await call('claim', JSON.stringify({ pairing_token: pair.current }), 'application/json');
      if (!claimed?.access_token) throw new Error('เชื่อมต่อไม่สำเร็จ กรุณาสแกน QR ใหม่');
      if (generation.current !== current) {
        void fetch('/api/mobile-camera?op=stop', { method: 'POST', headers: { Authorization: `Bearer ${claimed.access_token}` }, keepalive: true }).catch(() => {});
        return;
      }
      token.current = claimed.access_token; pair.current = '';
      if (!running.current) { await stop(); return; }
      setReady(false); setStatus(claimed); phase.current = claimed.state;
      const reference = claimed.reference_image;
      const stream = await openMatchingCamera(navigator.mediaDevices, reference.width, reference.height);
      if (!running.current || generation.current !== current) { stream.getTracks().forEach(track => track.stop()); return; }
      media.current = stream;
      if (!video.current) throw new Error('เปิดภาพกล้องไม่ได้');
      video.current.srcObject = media.current;
      await video.current.play();
      if (!running.current || generation.current !== current) { stream.getTracks().forEach(track => track.stop()); return; }
      while (running.current && generation.current === current) {
        const started = performance.now();
        let result: State | null;
        if (phase.current === 'AWAITING_APPROVAL') {
          result = await call('status');
        } else {
          const frame = document.createElement('canvas');
          const image = video.current;
          if (!image?.videoWidth) { await wait(300); continue; }
          if (!matchesCameraAspect(image.videoWidth, image.videoHeight, reference.width, reference.height)) {
            setError(`ภาพกล้อง ${image.videoWidth} × ${image.videoHeight} ไม่ตรงกับ calibration ${reference.width} × ${reference.height} กรุณาหมุนมือถือแนวนอน หากยังไม่ตรงต้องใช้กล้องที่รองรับสัดส่วนนี้หรือทำ calibration สำหรับกล้องมือถือ`);
            setStatus(old => old ? { ...old, result: undefined } : old);
            await wait(1000);
            continue;
          }
          setError('');
          const scale = Math.min(1, 1920/image.videoWidth);
          frame.width = Math.round(image.videoWidth*scale); frame.height = Math.round(image.videoHeight*scale);
          frame.getContext('2d')!.drawImage(image, 0, 0, frame.width, frame.height);
          const blob = await new Promise<Blob | null>(resolve => frame.toBlob(resolve, 'image/jpeg', .85));
          if (!blob) throw new Error('สร้างภาพจากกล้องไม่ได้');
          result = await call('frame', blob, 'image/jpeg');
        }
        if (!running.current || generation.current !== current) break;
        if (result) { phase.current = result.state; setStatus(result); setReceivedAt(performance.now()); }
        await wait(Math.max(200, 2500-(performance.now()-started)));
      }
    } catch (cause) {
      if (generation.current !== current) return;
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'เปิดกล้องไม่ได้');
      await stop();
    }
  }

  return <main className="mx-auto max-w-3xl space-y-4 p-4 pb-28">
    <h1 className="text-2xl font-semibold">กล้องมือถือ · ParkMap</h1>
    <p className="text-sm">ตั้งมือถือบนขาตั้ง หมุนแนวนอน และใช้กล้อง/มุมเดียวกับ calibration หากขยับกล้องให้หยุดแล้วจับคู่ใหม่</p>
    {!ready && !active && <p>สแกน QR ใหม่จาก Setup บนคอมเพื่อเริ่มใช้งาน ลิงก์ใช้จับคู่ได้ครั้งเดียว</p>}
    <div className="relative overflow-hidden rounded-xl bg-slate-950" style={{ aspectRatio: status ? `${status.reference_image.width}/${status.reference_image.height}` : '4/3' }}>
      <video ref={video} muted playsInline autoPlay className="h-full w-full object-contain" />
      {fresh && status?.result && <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
        {(status.result.image_regions ?? []).map((region, i) => <path key={i} d={region.rings.map(ring => `M${ring.map(p => `${p[0]},${p[1]}`).join(' L')} Z`).join(' ')}
          fill={region.kind === 'OCCUPIED' ? '#ef4444' : region.kind === 'WIDTH_SUFFICIENT' ? '#4ade80' : '#64748b'} fillOpacity={.35} fillRule="evenodd" />)}
      </svg>}
    </div>
    <p role="status" data-mobile-state={status?.state ?? 'READY'}>{labels[status?.state ?? ''] ?? 'พร้อมเปิดกล้อง'}</p>
    {status?.result && !fresh && <p className="text-amber-700">ผลเก่าแล้ว รอภาพใหม่ · ซ่อนพื้นที่เขียวชั่วคราว</p>}
    {status?.result && <p>ตรวจพบ {status.result.cars} รายการ · กว้างพอ {status.result.green_count} ช่วง · ประมวลผล {new Date(status.result.processed_at).toLocaleTimeString('th-TH')}</p>}
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
    <div className="fixed inset-x-0 bottom-0 z-10 flex flex-wrap justify-center gap-3 border-t bg-white/95 p-3 shadow-lg">
      <button data-mobile-start onClick={() => void start()} disabled={!ready || active} className="rounded-lg bg-blue-600 px-5 py-3 text-white disabled:opacity-40">เชื่อมต่อและเปิดกล้อง</button>
      <button data-mobile-stop onClick={() => void stop()} disabled={!active} className="rounded-lg border px-5 py-3 disabled:opacity-40">หยุดกล้อง</button>
      {active && status?.state === 'AWAITING_APPROVAL' && <button className="rounded-lg border px-4 py-3" onClick={() => { phase.current = 'AWAITING_PREVIEW'; }}>ส่งภาพตัวอย่างใหม่</button>}
    </div>
    <p className="text-xs text-slate-600">ส่งเฉพาะภาพล่าสุดทีละภาพ ไม่บันทึกวิดีโอ สีเขียวหมายถึงกว้างพอตามแบบจำลอง ยังไม่ตรวจความยาวและทางเข้า–ออก เมื่อออกจากหน้านี้จะหยุดกล้อง</p>
  </main>;
}
