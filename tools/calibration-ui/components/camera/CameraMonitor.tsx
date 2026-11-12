import { Camera, ImageIcon } from 'lucide-react';
import type { RefObject } from 'react';
import type { DetectionResponse } from '@/types/detection';
import type { DetectionRowAssignment } from '@/types/calibration';
import type { components } from '@/types/api.gen';

export function CameraMonitor({ imageUrl, videoUrl, videoRef, analysis, segmentation, assignments: _assignments = [] }: { imageUrl: string | null; videoUrl?: string | null; videoRef?: RefObject<HTMLVideoElement | null>; analysis: DetectionResponse | null; segmentation?: components['schemas']['SegmentationExperimentResult'] | null; assignments?: DetectionRowAssignment[] }) {
  const width = segmentation?.image_width ?? analysis?.image_width ?? 1000;
  const height = segmentation?.image_height ?? analysis?.image_height ?? 562;
  const preview = segmentation?.preview_url ?? imageUrl;
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="detected-image-title">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-2"><Camera className="size-5 text-blue-600" /><h2 id="detected-image-title" className="font-semibold">Detected image</h2></div>
        {analysis && <span className="text-sm font-semibold text-emerald-700">{analysis.detections.length} motorcycles</span>}
      </div>
      {segmentation && <p className="px-5 py-2 text-xs text-cyan-900">{segmentation.model} · ฟ้า = mask รถ · กรอบประเหลือง = ไม่มี mask{videoUrl ? ' · ผลบนเฟรมล่าสุดที่วิเคราะห์ ไม่ใช่ภาพวิดีโอขณะนี้' : ''}</p>}
      {videoUrl && <video ref={videoRef} src={videoUrl} aria-label="Parking camera video" className="mx-auto block max-h-[620px] max-w-full" autoPlay controls muted loop playsInline />}
      <div className="relative grid min-h-64 place-items-center overflow-hidden bg-slate-950">
        {preview ? (
          <div className="relative inline-block max-h-[620px] max-w-full">
            <img src={preview} alt="Parking camera analysis" className="block max-h-[620px] max-w-full object-contain" />
            {segmentation ? <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-label="Detected image segmentation">
              {segmentation.detections.map((item, index) => <g key={index}>{item.polygon?.length && item.polygon.length >= 3
                ? <polygon points={item.polygon.map(point => `${point.x},${point.y}`).join(' ')} fill="rgba(6,182,212,.22)" stroke="#06b6d4" strokeWidth=".002" />
                : <rect x={item.bbox.x} y={item.bbox.y} width={item.bbox.width} height={item.bbox.height} fill="none" stroke="#f59e0b" strokeDasharray=".006 .004" strokeWidth=".002" />}<title>Seg {index + 1} · {(item.confidence * 100).toFixed(1)}%</title></g>)}
              {segmentation.detections.map((item, index) => <circle key={`anchor-${index}`} data-ground-anchor={`detection_${index+1}`} cx={item.bbox.x+item.bbox.width/2} cy={item.bbox.y+item.bbox.height} r=".003" fill="#facc15" stroke="#0f172a" strokeWidth=".001"><title>จุดกึ่งกลางล่างโดยประมาณ · detection_{index+1}</title></circle>)}
            </svg> : analysis && !videoUrl && <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-label="Motorcycle detection boxes">
              {analysis.detections.map((detection, index) => {
                const x = detection.bbox.x * width, y = detection.bbox.y * height;
                const boxWidth = detection.bbox.width * width, boxHeight = detection.bbox.height * height;
                const groundX = (detection.bbox.x + detection.bbox.width / 2) * width;
                const groundY = (detection.bbox.y + detection.bbox.height) * height;
                return <g key={index}><rect x={x} y={y} width={boxWidth} height={boxHeight} fill="rgba(239,68,68,.08)" stroke="#fb7185" strokeWidth={Math.max(width, height) * .003} /><circle cx={groundX} cy={groundY} r={Math.max(width, height) * .005} fill="#22d3ee" stroke="#0f172a" strokeWidth={Math.max(width, height) * .0015} /></g>;
              })}
            </svg>}
          </div>
        ) : <div className="text-center text-slate-500"><ImageIcon className="mx-auto size-9" /><p className="mt-2 text-sm">{videoUrl ? 'Play video and press Analyze to view the analyzed frame' : 'Choose an image or video to begin'}</p></div>}
      </div>
    </section>
  );
}
