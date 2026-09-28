import { Camera, ImageIcon } from 'lucide-react';
import type { DetectionResponse } from '@/types/detection';

export function CameraMonitor({ imageUrl, analysis }: { imageUrl: string | null; analysis: DetectionResponse | null }) {
  const width = analysis?.image_width ?? 1000;
  const height = analysis?.image_height ?? 562;
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="detected-image-title">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-2"><Camera className="size-5 text-blue-600" /><h2 id="detected-image-title" className="font-semibold">Detected image</h2></div>
        {analysis && <span className="text-sm font-semibold text-emerald-700">{analysis.detections.length} motorcycles</span>}
      </div>
      <div className="relative grid min-h-64 place-items-center overflow-hidden bg-slate-950">
        {imageUrl ? (
          <div className="relative inline-block max-h-[620px] max-w-full">
            <img src={imageUrl} alt="Parking camera analysis" className="block max-h-[620px] max-w-full object-contain" />
            {analysis && <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-label="Motorcycle detection boxes">
              {analysis.detections.map((detection, index) => {
                const x = detection.bbox.x * width, y = detection.bbox.y * height;
                const boxWidth = detection.bbox.width * width, boxHeight = detection.bbox.height * height;
                const groundX = (detection.bbox.x + detection.bbox.width / 2) * width;
                const groundY = (detection.bbox.y + detection.bbox.height) * height;
                return <g key={index}><rect x={x} y={y} width={boxWidth} height={boxHeight} fill="rgba(239,68,68,.08)" stroke="#fb7185" strokeWidth={Math.max(width, height) * .003} /><circle cx={groundX} cy={groundY} r={Math.max(width, height) * .005} fill="#22d3ee" stroke="#0f172a" strokeWidth={Math.max(width, height) * .0015} /></g>;
              })}
            </svg>}
          </div>
        ) : <div className="text-center text-slate-500"><ImageIcon className="mx-auto size-9" /><p className="mt-2 text-sm">Choose an image to begin</p></div>}
      </div>
    </section>
  );
}
