'use client';

import { useEffect, useState } from 'react';

type CameraState = { session_id: string; state: string; preview_revision: number; preview_url?: string; qr_svg?: string;
  reference_image: { width: number; height: number }; remaining_s?: number;
  rows: { id: string; polygon: { x: number; y: number }[] }[];
  result?: { cars: number; green_count: number; processed_at: string } };
const labels: Record<string, string> = { PAIRING: 'รอมือถือสแกน QR', AWAITING_PREVIEW: 'รอภาพตัวอย่างจากมือถือ', AWAITING_APPROVAL: 'ตรวจมุมภาพก่อนอนุมัติ', LIVE: 'กำลังรับภาพและวิเคราะห์', STOPPED: 'หยุดแล้ว' };
const button = 'rounded-lg border bg-white px-4 py-2 text-sm disabled:opacity-40';

async function call(op: string, session = '', body?: unknown) {
  const query = new URLSearchParams({ op, ...(session ? { session } : {}) });
  const response = await fetch(`/api/lot-model-editor?${query}`, { method: op === 'mobile-status' ? 'GET' : 'POST', cache: 'no-store',
    headers: op === 'mobile-status' ? {} : { 'Content-Type': 'application/json' }, body: op === 'mobile-status' ? undefined : JSON.stringify(body ?? {}) });
  const result = await response.json();
  if (!response.ok) {
    const detail = result && typeof result === 'object' && 'detail' in result ? result.detail : undefined;
    throw new Error(typeof detail === 'string' ? detail : 'ทำรายการกล้องมือถือไม่สำเร็จ');
  }
  return result as CameraState;
}

export function MobileCameraSetup() {
  const [origin, setOrigin] = useState(''), [area, setArea] = useState('sripatum-near-lot');
  const [session, setSession] = useState<CameraState | null>(null), [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmed, setConfirmed] = useState<number | null>(null);
  const key = session?.session_id, stopped = session?.state === 'STOPPED';
  useEffect(() => {
    if (!key || stopped) return;
    let ended = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const result = await call('mobile-status', key); if (!ended) setSession(result); }
      catch (cause) { if (!ended) { setError(cause instanceof Error ? cause.message : 'ติดตามกล้องไม่ได้'); setSession(old => old ? { ...old, state: 'STOPPED', preview_url: undefined, result: undefined } : old); } }
      if (!ended) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => { ended = true; clearTimeout(timer); };
  }, [key, stopped]);

  async function create() {
    setBusy(true); setError(''); setConfirmed(null);
    try {
      const result = await call('mobile-create', '', { mobile_origin: origin.trim(), parking_area_id: area.trim() });
      setSession(result); setQr(result.qr_svg ?? '');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'สร้าง QR ไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  async function action(operation: 'mobile-approve' | 'mobile-stop') {
    if (!session) return;
    setBusy(true); setError('');
    try { const result = await call(operation, session.session_id, { preview_revision: session.preview_revision });
      setSession(old => old ? { ...old, ...result, ...(operation === 'mobile-stop' ? { preview_url: undefined, result: undefined } : {}) } : old); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'ทำรายการไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-2xl border bg-white p-5">
    <h2 className="text-xl font-semibold">สแกน QR เพื่อใช้กล้องมือถือ</h2>
    <p className="text-sm text-slate-600">ตั้งมือถือให้คงที่ ใช้มุมเดียวกับ calibration แล้วตรวจภาพและเส้นแถวบนคอมก่อนเริ่มส่งผลเข้า LIFF</p>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-sm">ลิงก์ HTTPS ของหน้า LIFF สำหรับมือถือ<input type="url" placeholder="https://your-link.trycloudflare.com" value={origin} onChange={e => setOrigin(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <label className="text-sm">รหัสพื้นที่จอด<input value={area} onChange={e => setArea(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
    </div>
    <p className="text-xs text-slate-500">ใช้ HTTPS ที่ชี้มาบริการ LIFF พอร์ต 3001 ไม่ใช่หน้า Setup หรือ Vision API · localhost ใช้เปิดจากมือถือไม่ได้</p>
    <div className="flex gap-2"><button className={button} disabled={busy || !origin || !area} onClick={() => void create()}>สร้าง QR ใหม่</button>
      <button className={button} disabled={busy || !session || stopped} onClick={() => void action('mobile-stop')}>หยุดและยกเลิกสิทธิ์มือถือ</button></div>
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {session && <p role="status" className="font-medium">{labels[session.state] ?? session.state} · กล้องอ้างอิง {session.reference_image.width} × {session.reference_image.height} · เซสชันเหลือ {Math.ceil((session.remaining_s ?? 0)/60)} นาที</p>}
    {qr && session?.state === 'PAIRING' && <div className="flex flex-wrap items-center gap-5 rounded-xl bg-slate-50 p-4">
      {/* QR generated locally; no capability is sent to a third-party QR service. */}
      <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`} alt="QR จับคู่กล้องมือถือ" width={240} height={240} />
      <p className="max-w-sm text-sm">สแกนด้วยกล้องมือถือ แล้วเปิดใน Safari/Chrome · QR ใช้ได้ครั้งเดียวภายใน 2 นาที · หากหมดอายุให้สร้างใหม่</p>
    </div>}
    {session?.preview_url && <div className="relative overflow-hidden rounded-xl bg-slate-950" style={{ aspectRatio: `${session.reference_image.width}/${session.reference_image.height}` }}>
      <img src={session.preview_url} alt="ภาพตัวอย่างเพื่อตรวจมุมกล้อง" className="h-full w-full object-contain" />
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
        {session.rows.map(row => <polygon key={row.id} points={row.polygon.map(p => `${p.x},${p.y}`).join(' ')} fill="#a855f722" stroke="#c084fc" strokeWidth=".003" />)}
      </svg>
    </div>}
    {session?.state === 'AWAITING_APPROVAL' && <div className="space-y-3 rounded-lg bg-amber-50 p-4 text-sm">
      <label className="flex gap-2"><input type="checkbox" checked={confirmed === session.preview_revision} onChange={e => setConfirmed(e.target.checked ? session.preview_revision : null)} />ยืนยันว่ามือถือตั้งอยู่กับที่ มุม/เลนส์ตรงกับ calibration และเส้นแถวตรงกับพื้นจริง</label>
      <button className={button} disabled={busy || confirmed !== session.preview_revision} onClick={() => void action('mobile-approve')}>ยืนยันมุมและเริ่มส่งผลเข้า LIFF</button>
    </div>}
    {session?.result?.processed_at && <p className="text-sm">ตรวจพบ {session.result.cars} รายการ · กว้างพอ {session.result.green_count} ช่วง · {new Date(session.result.processed_at).toLocaleTimeString('th-TH')}</p>}
    <p className="text-xs text-slate-500">ไม่บันทึกวิดีโอหรือภาพดิบลงดิสก์ · เซสชันหมดอายุใน 30 นาที · ระหว่างใช้มือถือจะพักผล photo worker สำหรับพื้นที่นี้ · หากภาพขาดหาย LIFF จะเปลี่ยนเป็นข้อมูลเก่า สีเขียวเป็นผลตรวจความกว้าง ไม่ใช่การรับรองว่าจอดได้</p>
  </section>;
}
