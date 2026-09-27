import { PARKMAP_API_URL, ParkingApiError } from './parking.ts';
import type { MotorcycleFittingConfiguration, MotorcycleFittingResponse } from '../types/motorcycleFitting.ts';

const url = `${PARKMAP_API_URL.replace(/\/$/, '')}/api/motorcycle-fitting`;
async function read(response: Response): Promise<MotorcycleFittingResponse> {
  if (!response.ok) throw new ParkingApiError(`Unable to process motorcycle fitting configuration (${response.status}).`);
  return await response.json() as MotorcycleFittingResponse;
}
export async function getMotorcycleFitting(signal?: AbortSignal) { return read(await fetch(url, { signal, cache: 'no-store', headers: { Accept: 'application/json' } })); }
export async function saveMotorcycleFitting(configuration: MotorcycleFittingConfiguration, signal?: AbortSignal) { return read(await fetch(url, { method: 'POST', signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(configuration) })); }
