export type ParkingStatus = 'occupied' | 'available' | 'uncertain';
export type SystemState = 'loading' | 'online' | 'offline' | 'error' | 'stale' | 'processing';
export type DataSourceMode = 'demo' | 'live';
export type DemoScenario = 'normal' | 'busy' | 'almost-full' | 'processing' | 'stale' | 'offline' | 'error';

export interface Point { x: number; y: number }
export interface ParkingObject { id: string; x: number; y: number; width: number; height: number; rotation?: number; status: ParkingStatus; confidence?: number; row_id?: string }
export interface ParkingZone { id: string; name: string; polygon: Point[] }
export interface CameraData { id: string; name: string; status: SystemState; frameUrl?: string | null; lastFrameAt?: string | null }
export interface ModelData { name: string; status: 'ready' | 'processing' | 'offline' | 'error' }
export interface ParkingSummary { motorcycles: number; available: number; occupied: number; uncertain: number }
export interface ParkingMapData { zone: ParkingZone; objects: ParkingObject[]; timestamp: string; cameraId?: string; camera?: CameraData; model?: ModelData; systemStatus?: SystemState; summary?: ParkingSummary }
export interface CameraOverlay { id: string; type: 'roi' | 'bounding-box' | 'anchor' | 'available' | 'uncertain'; points?: Point[]; x?: number; y?: number; width?: number; height?: number; label?: string }
export interface ParkingHistoryPoint { timestamp: string; motorcycles: number; available: number; uncertain?: number; occupancyPercent?: number }

export interface FastApiParkingResponse {
  camera_id: string;
  zone_id: string;
  timestamp: string;
  system_status?: SystemState;
  camera?: { id: string; name: string; status: SystemState; frame_url?: string | null; last_frame_at?: string | null };
  model?: { name: string; status: ModelData['status'] };
  summary?: ParkingSummary;
  occupied: Omit<ParkingObject, 'status'>[];
  available: Omit<ParkingObject, 'status'>[];
  uncertain: Omit<ParkingObject, 'status'>[];
}
