export interface DetectionBBox {
  /** Normalized left coordinate, not center-x. */
  x: number;
  /** Normalized top coordinate, not center-y. */
  y: number;
  width: number;
  height: number;
}

export interface Detection {
  class_id: number;
  class_name: string;
  confidence: number;
  bbox: DetectionBBox;
}

export interface DetectionModel {
  name: string;
  status: 'ready';
}

export interface DetectionInference {
  imgsz: number;
  confidence_threshold: number;
  nms_iou: number;
  processing_time_ms: number;
}

export interface DetectionResponse {
  image_width: number;
  image_height: number;
  model: DetectionModel;
  inference: DetectionInference;
  detections: Detection[];
}
