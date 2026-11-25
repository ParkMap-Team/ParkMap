import type { components } from '../types/api.gen.ts';

export type RouteConfiguration = components['schemas']['RouteConfiguration'];
export type RoutePlan = components['schemas']['RoutePlan'];
export type RoutePoint = components['schemas']['RouteWaypoint'];
export type RouteEditorState = components['schemas']['RouteEditorState'];
export type RoutePreview = components['schemas']['RowRoutePreview'];

export const ROUTE_ROWS = [['row_5', 'A'], ['row_4', 'B'], ['row_3', 'C'], ['row_2', 'D'], ['row_1', 'E']] as const;
export const ROUTE_COLORS: Record<string, string> = { row_5: '#7e22ce', row_4: '#047857', row_3: '#be123c', row_2: '#0369a1', row_1: '#b45309' };

export function insertRoutePoint(plan: RoutePlan, after: number, point?: RoutePoint): RoutePlan {
  if (plan.waypoints.length >= 32) return plan;
  const a = plan.waypoints[after];
  if (!a) return plan;
  const b = plan.waypoints[after + 1];
  const added = point ?? (b ? { x_m: (a.x_m + b.x_m) / 2, y_m: (a.y_m + b.y_m) / 2 } : { x_m: a.x_m + 1, y_m: a.y_m });
  return { ...plan, waypoints: [...plan.waypoints.slice(0, after + 1), added, ...plan.waypoints.slice(after + 1)] };
}

export function removeRoutePoint(plan: RoutePlan, index: number): RoutePlan {
  if (plan.waypoints.length <= 1) return plan;
  return { ...plan, waypoints: plan.waypoints.filter((_, i) => i !== index) };
}

export function moveRoutePoint(plan: RoutePlan, index: number, point: RoutePoint): RoutePlan {
  if (!Number.isFinite(point.x_m) || !Number.isFinite(point.y_m) || Math.abs(point.x_m) > 1000 || Math.abs(point.y_m) > 1000) return plan;
  return { ...plan, waypoints: plan.waypoints.map((old, i) => i === index ? point : old) };
}

export async function routeEditorRequest<T>(operation: 'routes' | 'route-preview', method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/lot-model-editor?op=${operation}`, { method, cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 409) throw new Error('มีคนบันทึกเส้นทางจากอีกแท็บ กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกใหม่');
    const detail = data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string'
      ? data.detail : 'ตรวจพิกัด จำนวนจุด และจุดที่ซ้ำกันติดกัน';
    throw new Error(detail);
  }
  return data as T;
}
