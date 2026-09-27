import { mockParkingData } from '@/lib/mockParkingData';
import type { FastApiParkingResponse, ParkingMapData, ParkingObject, ParkingStatus } from '@/types/parking';

export async function getParkingStatus(): Promise<ParkingMapData> { return mockParkingData; }

export function adaptFastApiParkingResponse(response: FastApiParkingResponse, zone: ParkingMapData['zone']): ParkingMapData {
  const withStatus = (items: Omit<ParkingObject, 'status'>[], status: ParkingStatus): ParkingObject[] => items.map((item) => ({ ...item, status }));
  return { cameraId: response.camera_id, timestamp: response.timestamp, zone: { ...zone, id: response.zone_id }, objects: [...withStatus(response.occupied, 'occupied'), ...withStatus(response.available, 'available'), ...withStatus(response.uncertain, 'uncertain')] };
}
