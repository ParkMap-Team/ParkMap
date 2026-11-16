import { useEffect, useRef, useState } from 'react';
import type { components } from '@/types/api.gen';

export function VideoClassifier({ file }: { file: File }) {
  const [fps, setFps] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<components['schemas']['VideoClassification'] | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const tooLarge = file.size > 25 * 1024 * 1024;

  useEffect(() => () => requestRef.current?.abort(), []);

  async function classify() {
    const request = new AbortController();
    requestRef.current = request;
    setBusy(true);
    setResult(null);
    setError(null);
    const form = new FormData();
    form.set('video', file);
    form.set('fps', fps);
    try {
      const response = await fetch('/api/classifier?op=video', { method: 'POST', body: form, signal: request.signal });
      if (!response.ok) {
        const problem = await response.json().catch(() => null);
        const detail = problem && typeof problem === 'object' && 'detail' in problem ? problem.detail : null;
        throw new Error(typeof detail === 'string' ? detail : 'วิเคราะห์วิดีโอไม่สำเร็จ');
      }
      const output: components['schemas']['VideoClassification'] = await response.json();
      if (!request.signal.aborted) setResult(output);
    } catch (reason) {
      if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : 'วิเคราะห์วิดีโอไม่สำเร็จ');
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }

  return (
    <section aria-labelledby="video-classifier-title" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 id="video-classifier-title" className="font-semibold">Classify Video</h2>
        <p className="mt-1 text-sm text-slate-600">ConvNeXt FT · MP4/WebM สูงสุด 30 วินาที และ 25 MB</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          เฟรมต่อวินาที
          <select className="rounded-lg border border-slate-300 px-2 py-2" value={fps} disabled={busy}
            onChange={event => setFps(event.target.value)}>
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </label>
        <button type="button" onClick={() => void classify()} disabled={busy || tooLarge}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Classify Video
        </button>
      </div>
      {busy && <p role="status" className="text-sm text-blue-700">กำลังตรวจจับ ติดตาม และจำแนกรถในคลิป…</p>}
      {tooLarge && <p role="alert" className="text-sm text-red-700">ไฟล์ใหญ่เกิน 25 MB กรุณาเลือกคลิปสั้นลง</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {result && (
        <div className="space-y-3">
          <p role="status" className="text-sm text-slate-700">
            วิเคราะห์แล้ว {result.sampled_frames} เฟรม · {result.tracks.length ? `ติดตามได้ ${result.tracks.length} คัน` : 'ไม่พบรถที่ติดตามได้'}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {result.tracks.map(track => (
              <li key={track.id} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
                {track.preview_url && <img src={track.preview_url} alt={`ภาพรถ Track ${track.id}`}
                  className="h-24 w-24 rounded-lg bg-slate-100 object-contain" />}
                <div className="min-w-0 text-sm">
                  <p className="break-words font-semibold">Track {track.id} · {track.family ?? 'ไม่แน่ใจ'}</p>
                  <p className="text-slate-600">{track.first_time.toFixed(1)}–{track.last_time.toFixed(1)} วินาที · {track.observations} เฟรม</p>
                  <ul className="mt-1 text-slate-600" aria-label="คะแนนเฉลี่ยสูงสุด 3 อันดับ">
                    {track.top3.map(item => <li key={item.family}>{item.family} · {(item.score * 100).toFixed(1)}%</li>)}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
