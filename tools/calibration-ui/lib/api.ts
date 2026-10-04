export const PARKMAP_API_URL = process.env.NEXT_PUBLIC_PARKMAP_API_URL ?? 'http://localhost:8000';

export class ParkingApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParkingApiError';
  }
}
