import type { ParkingMapData } from '@/types/parking';

export const mockParkingData: ParkingMapData = {
  cameraId: 'SPU_CAM_01', timestamp: '2026-09-27T08:30:00+07:00',
  zone: { id: 'zone_A', name: 'Parking Zone A', polygon: [{ x: 0.06, y: 0.13 }, { x: 0.91, y: 0.08 }, { x: 0.96, y: 0.84 }, { x: 0.12, y: 0.92 }] },
  objects: [
    { id: 'M001', x: 0.16, y: 0.23, width: 0.048, height: 0.15, rotation: -4, status: 'occupied', confidence: 0.96 },
    { id: 'M002', x: 0.25, y: 0.21, width: 0.045, height: 0.16, rotation: 2, status: 'occupied', confidence: 0.93 },
    { id: 'A001', x: 0.34, y: 0.22, width: 0.052, height: 0.16, rotation: 1, status: 'available' },
    { id: 'M003', x: 0.44, y: 0.20, width: 0.046, height: 0.16, rotation: -3, status: 'occupied', confidence: 0.89 },
    { id: 'U001', x: 0.54, y: 0.20, width: 0.055, height: 0.17, rotation: 4, status: 'uncertain', confidence: 0.61 },
    { id: 'M004', x: 0.66, y: 0.19, width: 0.047, height: 0.16, rotation: 3, status: 'occupied', confidence: 0.94 },
    { id: 'A002', x: 0.76, y: 0.18, width: 0.054, height: 0.17, rotation: -2, status: 'available' },
    { id: 'M005', x: 0.84, y: 0.17, width: 0.046, height: 0.15, rotation: 5, status: 'occupied', confidence: 0.91 },
    { id: 'M006', x: 0.20, y: 0.60, width: 0.048, height: 0.17, rotation: 177, status: 'occupied', confidence: 0.97 },
    { id: 'A003', x: 0.30, y: 0.61, width: 0.054, height: 0.17, rotation: 179, status: 'available' },
    { id: 'M007', x: 0.41, y: 0.59, width: 0.047, height: 0.16, rotation: 182, status: 'occupied', confidence: 0.88 },
    { id: 'M008', x: 0.52, y: 0.58, width: 0.045, height: 0.16, rotation: 176, status: 'occupied', confidence: 0.95 },
    { id: 'A004', x: 0.63, y: 0.57, width: 0.052, height: 0.17, rotation: 181, status: 'available' },
    { id: 'U002', x: 0.73, y: 0.57, width: 0.057, height: 0.18, rotation: 178, status: 'uncertain', confidence: 0.54 },
    { id: 'M009', x: 0.84, y: 0.55, width: 0.046, height: 0.16, rotation: 183, status: 'occupied', confidence: 0.92 },
  ],
};
