import type { components } from '../types/api.gen.ts';
export type AnnotationSample = components['schemas']['AnnotationSample'];
export type MotorcycleLabel = components['schemas']['MotorcycleLabel'];
export type LabelBox = components['schemas']['LabelBox'];
export type LabelPoint = components['schemas']['LabelPoint'];
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export function boxFromPoints(a: LabelPoint, b: LabelPoint): LabelBox {
  const x = Math.min(clamp(a.x), clamp(b.x)), y = Math.min(clamp(a.y), clamp(b.y));
  return { x, y, width: Math.max(clamp(a.x), clamp(b.x)) - x, height: Math.max(clamp(a.y), clamp(b.y)) - y };
}
export function moveBox(box: LabelBox, dx: number, dy: number): LabelBox {
  return { ...box, x: clamp(box.x + dx, 0, 1 - box.width), y: clamp(box.y + dy, 0, 1 - box.height) };
}
export function annotationUrl(dataset: string, op: string, id?: string) {
  return `/api/annotation?${new URLSearchParams({ dataset, op, ...(id ? { id } : {}) })}`;
}
export async function annotationRequest<T>(dataset: string, op: string, method = 'GET', id?: string, body?: unknown): Promise<T> {
  const response = await fetch(annotationUrl(dataset, op, id), { method, cache: 'no-store',
    ...(body instanceof FormData ? { body } : body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
  const data = await response.json();
  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : undefined;
    if (Array.isArray(detail)) {
      const messages = detail.slice(0, 3).map((item: unknown) => item && typeof item === 'object' && 'msg' in item ? String(item.msg) : 'ข้อมูล label ไม่ถูกต้อง');
      throw new Error(messages.join(' · '));
    }
    if (typeof detail === 'string' && detail.includes('filename date')) throw new Error('รูปที่มีวันที่เดียวกันในชื่อไฟล์ต้องอยู่ split เดียวกัน รูปที่อ่านวันที่ไม่ได้ก็รวมเป็นกลุ่มเดียว กรุณาตรวจ split ของภาพอื่นในชุด');
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail) ?? `Request failed (${response.status})`);
  }
  return data as T;
}
