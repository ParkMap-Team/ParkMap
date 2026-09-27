import { PARKMAP_API_URL, ParkingApiError } from './parking.ts';
import type { GroundPlaneCalibration, GroundPlaneCalibrationResponse } from '../types/groundPlaneCalibration.ts';

const url = `${PARKMAP_API_URL.replace(/\/$/, '')}/api/ground-plane-calibration`;
async function read(response: Response) { if (!response.ok) throw new ParkingApiError(`Unable to process ground-plane calibration (${response.status}).`); return await response.json() as GroundPlaneCalibrationResponse; }
export async function getGroundPlaneCalibration(signal?: AbortSignal) { return read(await fetch(url, { signal, cache: 'no-store' })); }
export async function saveGroundPlaneCalibration(calibration: GroundPlaneCalibration, signal?: AbortSignal) { return read(await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(calibration) })); }
