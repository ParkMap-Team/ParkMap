import { PARKMAP_API_URL, ParkingApiError } from './parking.ts';
import type { PhysicalRowGeometryConfig, PhysicalRowGeometryResponse } from '../types/physicalRowGeometry.ts';

const url = `${PARKMAP_API_URL.replace(/\/$/, '')}/api/physical-row-geometry`;
async function read(response: Response): Promise<PhysicalRowGeometryResponse> { if (!response.ok) { let message = `Unable to process physical row endpoints (${response.status}).`; try { const body = await response.json() as { detail?: string }; if (body.detail) message = body.detail; } catch { /* Use status message. */ } throw new ParkingApiError(message); } return await response.json() as PhysicalRowGeometryResponse; }
export async function getPhysicalRowGeometry(signal?: AbortSignal) { return read(await fetch(url, { signal, cache: 'no-store' })); }
export async function savePhysicalRowGeometry(config: PhysicalRowGeometryConfig, signal?: AbortSignal) { const saved = await read(await fetch(url, { method: 'POST', signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(config) })); const verified = await getPhysicalRowGeometry(signal); if (JSON.stringify(saved.config) !== JSON.stringify(verified.config)) throw new ParkingApiError('Physical endpoint save verification failed.'); return verified; }

