import type { ParkingHistoryPoint } from '@/types/parking';

export const mockParkingHistory: ParkingHistoryPoint[] = [
  { timestamp: '08:00', motorcycles: 15, available: 40, uncertain: 1, occupancyPercent: 27 },
  { timestamp: '10:00', motorcycles: 32, available: 23, uncertain: 2, occupancyPercent: 58 },
  { timestamp: '12:00', motorcycles: 48, available: 7, uncertain: 3, occupancyPercent: 87 },
  { timestamp: '14:00', motorcycles: 40, available: 15, uncertain: 2, occupancyPercent: 73 },
  { timestamp: '16:00', motorcycles: 21, available: 34, uncertain: 1, occupancyPercent: 38 },
  { timestamp: '18:00', motorcycles: 11, available: 44, uncertain: 0, occupancyPercent: 20 },
];
