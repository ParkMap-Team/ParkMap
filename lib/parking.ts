import { getDemoParkingData } from '@/lib/mockParkingData';
import type { DataSourceMode, DemoScenario, FastApiParkingResponse, ParkingMapData, ParkingObject, ParkingStatus } from '@/types/parking';

export const STALE_AFTER_SECONDS = 30;
export const PARKING_POLL_INTERVAL_MS = 5000;
export const PARKMAP_API_URL = process.env.NEXT_PUBLIC_PARKMAP_API_URL ?? 'http://localhost:8000';

export class ParkingApiError extends Error {
  constructor(message: string, readonly kind: 'offline' | 'error' = 'error') { super(message); this.name = 'ParkingApiError'; }
}

export function isParkingDataStale(timestamp: string, now = Date.now()): boolean {
  const parsed = new Date(timestamp).getTime();
  return Number.isNaN(parsed) || now - parsed > STALE_AFTER_SECONDS * 1000;
}

export async function getParkingStatus({ mode = 'demo', scenario = 'normal', signal }: { mode?: DataSourceMode; scenario?: DemoScenario; signal?: AbortSignal } = {}): Promise<ParkingMapData> {
  if (mode === 'demo') return getDemoParkingData(scenario);
  try {
    const response = await fetch(`${PARKMAP_API_URL.replace(/\/$/, '')}/api/parking/status`, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new ParkingApiError(`ParkMap API returned ${response.status}.`);
    return adaptFastApiParkingResponse(await response.json() as FastApiParkingResponse);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof ParkingApiError) throw error;
    throw new ParkingApiError('Unable to connect to ParkMap API.', 'offline');
  }
}

export function adaptFastApiParkingResponse(response: FastApiParkingResponse): ParkingMapData {
  const withStatus = (items: Omit<ParkingObject, 'status'>[] = [], status: ParkingStatus): ParkingObject[] => items.map((item) => ({ ...item, status }));
  const objects = [...withStatus(response.occupied, 'occupied'), ...withStatus(response.available, 'available'), ...withStatus(response.uncertain, 'uncertain')];
  return {
    cameraId: response.camera_id,
    timestamp: response.timestamp,
    systemStatus: response.system_status ?? 'online',
    camera: response.camera ? { id: response.camera.id, name: response.camera.name, status: response.camera.status, frameUrl: response.camera.frame_url, lastFrameAt: response.camera.last_frame_at } : undefined,
    model: response.model,
    summary: response.summary ?? summarizeParkingObjects(objects),
    zone: { id: response.zone_id, name: response.zone_id.replaceAll('_', ' '), polygon: [{ x: 0.05, y: 0.1 }, { x: 0.95, y: 0.1 }, { x: 0.95, y: 0.9 }, { x: 0.05, y: 0.9 }] },
    objects,
  };
}

export function summarizeParkingObjects(objects: ParkingObject[]) {
  const count = (status: ParkingStatus) => objects.filter((item) => item.status === status).length;
  return { motorcycles: count('occupied'), occupied: count('occupied'), available: count('available'), uncertain: count('uncertain') };
}
