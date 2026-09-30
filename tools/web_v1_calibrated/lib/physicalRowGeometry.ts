import { PARKMAP_API_URL, ParkingApiError } from './api.ts';
import type { PhysicalRowGeometryResponse } from '../types/physicalRowGeometry.ts';

const url = `${PARKMAP_API_URL.replace(/\/$/, '')}/api/physical-row-geometry`;
async function read(response: Response): Promise<PhysicalRowGeometryResponse> { if (!response.ok) { let message = `Unable to process physical row endpoints (${response.status}).`; try { const body = await response.json() as { detail?: string }; if (body.detail) message = body.detail; } catch { /* Use status message. */ } throw new ParkingApiError(message); } return await response.json() as PhysicalRowGeometryResponse; }
export async function getPhysicalRowGeometry(signal?: AbortSignal) { return read(await fetch(url, { signal, cache: 'no-store' })); }

