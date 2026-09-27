import { PARKMAP_API_URL, ParkingApiError } from './parking.ts';
import type { GroundPlaneCalibration, GroundPlaneCalibrationResponse } from '../types/groundPlaneCalibration.ts';
import { groundPlaneConfigsMatch } from './groundPlaneCalibrationState.ts';

const url = `${PARKMAP_API_URL.replace(/\/$/, '')}/api/ground-plane-calibration`;
async function read(response: Response) { if (!response.ok) throw new ParkingApiError(`Unable to process ground-plane calibration (${response.status}).`); return await response.json() as GroundPlaneCalibrationResponse; }
export async function getGroundPlaneCalibration(signal?: AbortSignal) { return read(await fetch(url, { signal, cache: 'no-store' })); }
export async function saveGroundPlaneCalibration(calibration: GroundPlaneCalibration, signal?: AbortSignal) { return read(await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(calibration) })); }
export async function saveAndVerifyGroundPlaneCalibration(calibration: GroundPlaneCalibration, signal?: AbortSignal): Promise<GroundPlaneCalibrationResponse> { await saveGroundPlaneCalibration(calibration, signal); const reloaded = await getGroundPlaneCalibration(signal); if (!groundPlaneConfigsMatch(calibration, reloaded.calibration)) throw new ParkingApiError('Ground-plane calibration save verification failed: read-back data does not match the submitted values.'); return reloaded; }
