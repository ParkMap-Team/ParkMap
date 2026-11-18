// Operator UI settings. The API supplies the inference mode, padding and selection cap.
export const REVIEW_CONFIDENCE_PERCENT = 70;
export const CAPTURE_PREVIEW_MAX_HEIGHT_PX = 320;
export const CROP_PREVIEW_MAX_SIDE_PX = 240;
export const CROP_PREVIEW_JPEG_QUALITY = 0.85;
export const FRAME_JPEG_QUALITY = 0.92;
export const MAX_FRAME_CANDIDATES = 6;
export const CROP_RANK_SIZE_BONUS = 0.15;
export const CROP_RANK_REFERENCE_SIDE_PX = 224;
export const VIDEO_FRAME_WAIT_MS = 10_000;
export const VIDEO_FRAME_INTERVAL_SECONDS = 5;
export const MAX_VIDEO_FRAMES = 360;
export const MAX_LOCAL_VIDEO_MIB = 500;
export const MAX_UPLOAD_MIB = 25;
export const BYTES_PER_MIB = 1024 * 1024;
export const OPERATOR_MULTIPART_OVERHEAD_MIB = 1;
export const OPERATOR_JSON_LIMIT_MIB = 1;
export const DEFAULT_CLEARANCE_MARGIN_M = 0;
export const MAX_CLEARANCE_MARGIN_M = 1;
export const CLEARANCE_MARGIN_STEP_M = 0.01;
export const OPERATOR_REQUEST_TIMEOUT_MS = 30_000;
export const OPERATOR_FRAME_TIMEOUT_MS = 120_000;
export const OPERATOR_VIDEO_TIMEOUT_MS = 300_000;
export const DETECTOR_OPTIONS = [
  { value: 'yolo26n', label: 'YOLO26n Detect · Round 10' },
  { value: 'yolo26n-seg', label: 'YOLO26n Seg · Round 8' },
] as const;
export type ParkingDetector = typeof DETECTOR_OPTIONS[number]['value'];
export const DEFAULT_IMAGE_DETECTOR: ParkingDetector = 'yolo26n-seg';
export const DEFAULT_VIDEO_DETECTOR: ParkingDetector = 'yolo26n';
