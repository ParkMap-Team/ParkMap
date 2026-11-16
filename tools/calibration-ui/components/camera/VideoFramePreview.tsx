import { Camera, Check, ChevronDown, ScanSearch } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { detectMotorcycleFrame } from '@/lib/detection';
import { CAPTURE_PREVIEW_MAX_HEIGHT_PX, REVIEW_CONFIDENCE_PERCENT, type ParkingDetector } from '@/lib/parkingSettings';
import { captureVideoFrame, cropFramePreviews, frameCandidateScore, frameCandidateTimes, frameCropKey, reviewFrameCrops, waitForVideoFrame } from '@/lib/videoFrames';
import type { components } from '@/types/api.gen';

type Detection = components['schemas']['Detection'];
type DetectionPreview = Detection & { preview: string };
type Crop = components['schemas']['SelectedFrameCrop'];
type Frame = { image: File; time: number; width: number; height: number };
type FrameDetection = components['schemas']['FrameDetectionResponse'];
type Candidate = { id: string; still: Frame; detection: FrameDetection; previews: DetectionPreview[]; score: number };
type DetectionMode = FrameDetection['mode'];
type Operation = 'capture' | 'detect' | 'auto' | 'classify';

async function postClassification(form: FormData, signal: AbortSignal): Promise<components['schemas']['SavedFrameClassification']> {
  const response = await fetch('/api/classifier?op=classify-frame', { method: 'POST', body: form, signal });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const detail = problem && typeof problem === 'object' && 'detail' in problem ? problem.detail : null;
    throw new Error(typeof detail === 'string' ? detail : 'ประมวลผลเฟรมไม่สำเร็จ');
  }
  const result = await response.json() as components['schemas']['SavedFrameClassification'];
  if (result.saved_review_id !== form.get('review_id')) {
    throw new Error('Vision API ยังไม่ยืนยันการบันทึก กรุณารีสตาร์ต Vision API แล้วลองอีกครั้ง');
  }
  return result;
}

async function getFrame(video: HTMLVideoElement): Promise<Frame> {
  const { currentTime: time, videoWidth: width, videoHeight: height } = video;
  return { image: await captureVideoFrame(video), time, width, height };
}

async function makePreviews(image: File, { detections, crop_padding_ratio }: FrameDetection, signal: AbortSignal): Promise<DetectionPreview[]> {
  signal.throwIfAborted();
  const previews = await cropFramePreviews(image, detections.map(item => item.bbox), crop_padding_ratio);
  signal.throwIfAborted();
  return detections.map((item, index) => ({ ...item, preview: previews[index] }));
}

export function VideoFramePreview({ videoUrl, detector }: { videoUrl: string; detector: ParkingDetector }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const [showVideo, setShowVideo] = useState(true);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<(Frame & { url: string }) | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, Crop>>({});
  const [minimumConfidence, setMinimumConfidence] = useState(REVIEW_CONFIDENCE_PERCENT);
  const clipId = useRef<string | null>(null);
  const groups = reviewFrameCrops<DetectionPreview, Candidate>(candidates, minimumConfidence);
  const active = groups.find(group => group.frame.still.image === frame?.image);
  const visibleCount = groups.reduce((count, group) => count + group.crops.length, 0);
  const detectionCount = candidates.reduce((count, candidate) => count + candidate.previews.length, 0);
  const selectedGroups = groups.map(group => ({
    frame: group.frame, crops: group.crops.filter(crop => selected.has(crop.key)),
  })).filter(group => group.crops.length);
  const selectedCount = selectedGroups.reduce((count, group) => count + group.crops.length, 0);
  const pending = useRef<AbortController | null>(null);
  const previousDetector = useRef(detector);
  const resetReview = useCallback(() => {
    setCandidates([]);
    setSelected(new Set());
    setResults({});
  }, []);

  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (previousDetector.current === detector) return;
    previousDetector.current = detector;
    pending.current?.abort();
    setOperation(null);
    setProgress('');
    setError(null);
    resetReview();
  }, [detector, resetReview]);
  const frameUrl = frame?.url;
  useEffect(() => () => {
    if (frameUrl) URL.revokeObjectURL(frameUrl);
  }, [frameUrl]);

  async function run(name: Operation, task: (signal: AbortSignal) => Promise<void>) {
    const request = new AbortController();
    pending.current?.abort();
    pending.current = request;
    setOperation(name);
    setError(null);
    try {
      await task(request.signal);
    } catch (reason) {
      if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : 'ประมวลผลเฟรมไม่สำเร็จ');
    } finally {
      if (!request.signal.aborted) {
        setOperation(null);
        setProgress('');
      }
    }
  }

  async function analyzeFrame(still: Frame, signal: AbortSignal, mode?: DetectionMode): Promise<Candidate> {
    const detection = await detectMotorcycleFrame(still.image, detector, signal, mode);
    const previews = await makePreviews(still.image, detection, signal);
    return {
      id: crypto.randomUUID(), still, detection, previews,
      score: frameCandidateScore(detection.detections, still.width, still.height),
    };
  }

  function showFrame(still: Frame) {
    setFrame({ ...still, url: URL.createObjectURL(still.image) });
    setShowVideo(false);
  }

  async function detectStill(still: Frame, signal: AbortSignal, mode?: DetectionMode) {
    setProgress('กำลังหากรอบมอเตอร์ไซค์ในเฟรม');
    const candidate = await analyzeFrame(still, signal, mode);
    signal.throwIfAborted();
    setCandidates(previous => {
      const index = previous.findIndex(item => item.still.image === still.image);
      return index < 0 ? [candidate, ...previous] : previous.map((item, position) => position === index ? candidate : item);
    });
  }

  function capture() {
    const video = videoRef.current;
    if (!video || video.seeking) return;
    video.pause();
    void run('capture', async signal => {
      const still = await getFrame(video);
      signal.throwIfAborted();
      showFrame(still);
      await detectStill(still, signal);
    });
  }

  function autoSelect() {
    videoRef.current?.pause();
    void run('auto', async signal => {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      try {
        await waitForVideoFrame(video, 'loadeddata', signal, () => { video.src = videoUrl; });
        const times = frameCandidateTimes(video.duration);
        if (!times.length) throw new Error('อ่านระยะเวลาคลิปไม่ได้ ลองเลือกเฟรมด้วย Capture Frame');
        const sampled: Candidate[] = [];
        for (const [index, time] of times.entries()) {
          setProgress(`กำลังตรวจเฟรม ${index + 1} จาก ${times.length}`);
          await waitForVideoFrame(video, 'seeked', signal, () => { video.currentTime = time; });
          const still = await getFrame(video);
          signal.throwIfAborted();
          sampled.push(await analyzeFrame(still, signal));
        }
        signal.throwIfAborted();
        sampled.sort((left, right) => right.score - left.score);
        showFrame(sampled[0].still);
        resetReview();
        setCandidates(sampled);
      } finally {
        video.removeAttribute('src');
        video.load();
      }
    });
  }

  function detectCurrentFrame(mode?: DetectionMode) {
    if (!frame) return;
    void run('detect', signal => detectStill(frame, signal, mode));
  }

  function classify() {
    if (!selectedCount) return;
    void run('classify', async signal => {
      const currentClipId = clipId.current ??= crypto.randomUUID();
      for (const [index, group] of selectedGroups.entries()) {
        const { id: reviewId, still } = group.frame;
        setProgress(`กำลังจำแนกและบันทึกเฟรม ${index + 1} จาก ${selectedGroups.length}`);
        const form = new FormData();
        form.set('image', still.image);
        form.set('review_id', reviewId);
        form.set('clip_id', currentClipId);
        form.set('frame_time_seconds', String(still.time));
        form.set('boxes', JSON.stringify(group.crops.map(({ id, bbox, confidence }) => ({ id, bbox, confidence }))));
        const result = await postClassification(form, signal);
        signal.throwIfAborted();
        setResults(previous => ({
          ...previous,
          ...Object.fromEntries(result.crops.map(crop => [frameCropKey(reviewId, crop.id), crop])),
        }));
        setSelected(previous => {
          const remaining = new Set(previous);
          for (const crop of group.crops) remaining.delete(crop.key);
          return remaining;
        });
      }
    });
  }

  function toggle(key: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <>
      <details open={showVideo} onToggle={event => setShowVideo(event.currentTarget.open)}>
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-slate-700">วิดีโอต้นฉบับ</summary>
        <div className="bg-slate-950">
          <video ref={videoRef} src={videoUrl} aria-label="Parking camera video"
            className="mx-auto block max-h-[620px] max-w-full" preload="auto" controls muted loop playsInline
            onLoadedData={() => setReady(true)} onSeeking={() => setReady(false)} onSeeked={() => setReady(true)}
            onError={() => {
              setReady(false);
              setError('Unable to play this video. Try an MP4 or WebM supported by your browser.');
            }} />
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-5 py-3">
        <button type="button" disabled={!ready || !!operation} onClick={autoSelect}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          <ScanSearch className="size-4" aria-hidden="true" />
          Auto Select Frame
        </button>
        <button type="button" disabled={!ready || !!operation} onClick={capture}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">
          <Camera className="size-4" aria-hidden="true" />
          {operation === 'capture' ? 'Capturing & Detecting…' : 'Capture Frame'}
        </button>
        {frame && !active && operation !== 'capture' && <button type="button" disabled={!!operation} onClick={() => detectCurrentFrame()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">
          <ScanSearch className="size-4" aria-hidden="true" />
          {operation === 'detect' ? 'Detecting…' : 'ตรวจเฟรมนี้'}
        </button>}
        {frame && active && <button type="button" disabled={!!operation}
          onClick={() => detectCurrentFrame(active.frame.detection.mode === 'wide' ? 'near' : 'wide')}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">
          {active.frame.detection.mode === 'wide' ? 'ตรวจรถใกล้' : 'ตรวจแบบลานกว้าง'}
        </button>}
        {operation === 'auto' && <button type="button" className="px-2 py-2 text-sm font-semibold" onClick={() => {
          pending.current?.abort();
          setOperation(null);
          setProgress('');
        }}>ยกเลิก</button>}
      </div>
      {progress && <p role="status" className="px-5 pb-3 text-sm text-blue-700">{progress}</p>}
      {error && <p role="alert" className="px-5 pb-3 text-sm text-red-700">{error}</p>}
      {frame && (
        <div className="grid gap-4 border-t border-slate-200 bg-slate-50 p-4 sm:p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
          <figure className="min-w-0 overflow-hidden rounded-xl bg-slate-950 text-white shadow-sm">
            <figcaption role="status" className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3">
              <span className="text-sm font-semibold">เฟรมที่กำลังดู</span>
              <span className="text-xs tabular-nums text-slate-300">{frame.time.toFixed(1)} s · {frame.width} × {frame.height} px</span>
            </figcaption>
            <div className="flex justify-center overflow-hidden bg-black">
              <div className="relative max-w-full" style={{ width: Math.min(frame.width, CAPTURE_PREVIEW_MAX_HEIGHT_PX * frame.width / frame.height) }}>
                <img src={frame.url} width={frame.width} height={frame.height}
                  alt="ภาพเต็มของเฟรมที่ Capture" className="block h-auto w-full" />
                <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                  {active?.crops.map(({ id, bbox, key }) => {
                    const isSelected = selected.has(key);
                    return <div key={id}
                      className={`absolute border-2 ${isSelected ? 'z-10 border-emerald-300' : 'border-cyan-300'}`}
                      style={{ left: `${bbox.x * 100}%`, top: `${bbox.y * 100}%`, width: `${bbox.width * 100}%`, height: `${bbox.height * 100}%` }}>
                      <span className={`absolute left-0 top-0 px-1 text-xs font-semibold tabular-nums text-slate-950 ${isSelected ? 'bg-emerald-300' : 'bg-cyan-300'}`}>
                        #{id}
                      </span>
                    </div>;
                  })}
                </div>
              </div>
            </div>
            {candidates.length > 1 && <div className="flex flex-wrap gap-2 border-t border-slate-800 px-3 py-3" role="group" aria-label="เฟรมที่ตรวจแล้ว">
              {candidates.map(candidate => {
                const confidence = Math.max(0, ...candidate.detection.detections.map(item => item.confidence));
                return <button type="button" key={candidate.id} disabled={!!operation} aria-pressed={frame.image === candidate.still.image}
                  onClick={() => showFrame(candidate.still)}
                  className="min-h-11 rounded-lg border border-slate-700 px-2.5 text-left text-xs tabular-nums text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 aria-pressed:border-sky-400 aria-pressed:bg-sky-950 disabled:opacity-50">
                  <span className="block font-semibold text-white">{candidate.still.time.toFixed(1)} s</span>
                  <span>{confidence > 0 ? `YOLO ${Math.round(confidence * 100)}%` : 'ไม่พบรถ'}</span>
                </button>;
              })}
            </div>}
          </figure>
          <section aria-label="ภาพครอปมอเตอร์ไซค์" className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
              <div>
                <h3 className="text-base font-semibold text-slate-900">ภาพครอปมอเตอร์ไซค์</h3>
                {candidates.length > 0 && <p role="status" className="mt-1 text-xs tabular-nums text-slate-600">
                  แสดง {visibleCount} จาก {detectionCount} กรอบ · {candidates.length} เฟรม
                </p>}
              </div>
              {detectionCount > 0 && <label className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-slate-700">
                <span>คะแนนขั้นต่ำ</span>
                <input type="range" min="0" max="100" step="1" value={minimumConfidence} disabled={!!operation}
                  onChange={event => {
                    const nextMinimum = event.target.valueAsNumber;
                    setMinimumConfidence(nextMinimum);
                    const visibleKeys = reviewFrameCrops(candidates, nextMinimum)
                      .flatMap(group => group.crops.map(crop => crop.key));
                    setSelected(previous => new Set(visibleKeys.filter(key => previous.has(key))));
                  }} className="h-9 w-24 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 sm:w-28" />
                <span className="w-9 text-right font-semibold tabular-nums text-slate-900">{minimumConfidence}%</span>
              </label>}
            </div>
            {visibleCount > 0 && <div className="flex flex-wrap items-center justify-between gap-2 border-y border-slate-200 bg-slate-50 px-4 py-2">
              <span className="text-sm font-medium tabular-nums text-slate-700">เลือกแล้ว {selectedCount} ภาพ</span>
              <button type="button" disabled={!selectedCount || !!operation} onClick={classify}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-600">
                <ScanSearch className="size-4" aria-hidden="true" />
                {operation === 'classify' ? 'Classifying…' : 'Classify Selected'}
              </button>
            </div>}
            {visibleCount > 0 ? <ul aria-label="ภาพครอปจากทุกเฟรม"
              className="grid grid-cols-2 items-start gap-3 p-3 min-[540px]:grid-cols-3 lg:max-h-[32rem] lg:grid-cols-2 lg:overflow-y-auto xl:grid-cols-3">
              {groups.flatMap(({ frame: candidate, crops }) => {
                const time = candidate.still.time.toFixed(1);
                const atLimit = crops.filter(crop => selected.has(crop.key)).length >= candidate.detection.max_selected_boxes;
                return crops.map(({ id, key, preview, confidence }) => {
                  const result = results[key];
                  const isSelected = selected.has(key);
                  return <li key={key} className={`min-w-0 overflow-hidden rounded-xl border bg-white ${isSelected ? 'border-blue-600 ring-1 ring-blue-600' : 'border-slate-200'}`}>
                    <button type="button" disabled={!!operation || (atLimit && !isSelected)} aria-pressed={isSelected}
                      aria-label={`กรอบ ${id} ที่ ${time} วินาที คะแนนตรวจจับ ${Math.round(confidence * 100)}%`} onClick={() => toggle(key)}
                      className={`group block w-full text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                      <div className="relative grid h-36 place-items-center bg-slate-100 sm:h-40">
                        <img src={preview} alt={`ภาพครอปกรอบ ${id} ที่ ${time} วินาที`} className="size-full min-h-0 object-contain" loading="lazy" />
                        <span aria-hidden="true" className={`absolute right-2 top-2 grid size-6 place-items-center rounded-md border shadow-sm ${isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-400 bg-white/95 group-hover:border-blue-600'}`}>
                          {isSelected && <Check className="size-4" />}
                        </span>
                      </div>
                      <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-2.5 py-2 text-xs font-semibold tabular-nums text-slate-700">
                        <span>{time} s · #{id}</span>
                        <span>YOLO {Math.round(confidence * 100)}%</span>
                      </span>
                    </button>
                    {result && <div className="space-y-1 border-t border-slate-200 px-2.5 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <p className="min-w-0 break-words text-sm font-semibold text-slate-950">{result.family ?? 'ไม่แน่ใจ'}</p>
                        <span className="text-xs font-medium text-emerald-700">บันทึกแล้ว</span>
                      </div>
                      <details className="group/details text-xs text-slate-700">
                        <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 [&::-webkit-details-marker]:hidden">
                          <ChevronDown className="size-3.5 group-open/details:rotate-180" aria-hidden="true" />
                          คะแนน Top {result.top3.length}
                        </summary>
                        <ul className="space-y-1 pb-1" aria-label={`คะแนนจำแนกของกรอบ ${id} ที่ ${time} วินาที`}>
                          {result.top3.map(item => <li key={item.family} className="flex justify-between gap-2 tabular-nums">
                            <span className="min-w-0 break-words">{item.family}</span><span>{(item.score * 100).toFixed(1)}%</span>
                          </li>)}
                        </ul>
                      </details>
                    </div>}
                  </li>;
                });
              })}
            </ul> : candidates.length > 0 && <p className="border-t border-slate-200 px-4 py-6 text-sm text-slate-600">
              {detectionCount ? 'ไม่มีกรอบถึงคะแนนขั้นต่ำ ลองเลื่อนลดคะแนนเพื่อดูภาพครอปเพิ่ม' : 'YOLO ไม่พบกรอบมอเตอร์ไซค์ในเฟรมที่ตรวจ'}
            </p>}
          </section>
        </div>
      )}
    </>
  );
}
