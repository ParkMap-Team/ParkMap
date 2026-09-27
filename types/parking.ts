export type ParkingStatus = 'occupied' | 'available' | 'uncertain';
export interface Point { x: number; y: number }
export interface ParkingObject { id: string; x: number; y: number; width: number; height: number; rotation?: number; status: ParkingStatus; confidence?: number }
export interface ParkingZone { id: string; name: string; polygon: Point[] }
export interface ParkingMapData { zone: ParkingZone; objects: ParkingObject[]; timestamp: string; cameraId?: string }
export interface FastApiParkingResponse { camera_id: string; zone_id: string; timestamp: string; occupied: Omit<ParkingObject, 'status'>[]; available: Omit<ParkingObject, 'status'>[]; uncertain: Omit<ParkingObject, 'status'>[] }
