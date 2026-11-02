import type { LandmarkKind, LotLandmark, LotModelDefinition, MetricPoint } from '../types/lotModel.ts';

const EPSILON = 1e-7;
const distance = (a: MetricPoint, b: MetricPoint) => Math.hypot(a.x_m - b.x_m, a.y_m - b.y_m);

const ROI_PREFIX = ':roi:'; // ':' cannot occur in API landmark identifiers.
export const isRoiId = (id: string | null) => !!id?.startsWith(ROI_PREFIX);

export function adoptRoiOutline(model: LotModelDefinition, id: string): LotModelDefinition {
  const area = model.parking_areas[0];
  if (model.parking_areas.length !== 1 || id !== ROI_PREFIX + area.parking_area_id) {
    throw new Error('ใช้ ROI เป็นขอบลานได้เมื่อมีพื้นที่ ROI เดียวเท่านั้น');
  }
  return { ...model, outline: area.polygon.map((ring) => ring.map((point) => ({ ...point }))) };
}

export function roiObjects(model: LotModelDefinition): LotLandmark[] {
  return model.parking_areas.map((area) => {
    const points = area.polygon[0];
    return { landmark_id: ROI_PREFIX + area.parking_area_id, name: `ROI ${area.parking_area_id}`,
      kind: 'AISLE', measurement_source: 'ESTIMATED', polygon: area.polygon,
      position: { x_m: (Math.min(...points.map((p) => p.x_m)) + Math.max(...points.map((p) => p.x_m))) / 2,
        y_m: (Math.min(...points.map((p) => p.y_m)) + Math.max(...points.map((p) => p.y_m))) / 2 } };
  });
}

/** ROI adapters are editor-only; preserve the actual parking-area metadata and API shape. */
export function replaceEditorObject(model: LotModelDefinition, object: LotLandmark): LotModelDefinition {
  if (isRoiId(object.landmark_id)) return { ...model, parking_areas: model.parking_areas.map((area) =>
    ROI_PREFIX + area.parking_area_id === object.landmark_id ? { ...area, polygon: object.polygon! } : area) };
  return { ...model, landmarks: (model.landmarks ?? []).map((current) => current.landmark_id === object.landmark_id ? object : current) };
}

/** Rotate every ring about the outer bounds centre, preserving free shapes and holes. */
export function rotatePolygonObject(object: LotLandmark, degrees: number): LotLandmark {
  if (!Number.isFinite(degrees)) throw new Error('มุมต้องเป็นตัวเลขที่มีค่าจำกัด');
  if (!degrees) return object;
  const radians = (degrees % 360) * Math.PI / 180;
  const c = Math.cos(radians), s = Math.sin(radians);
  const rotate = (point: MetricPoint): MetricPoint => ({
    x_m: object.position.x_m + (point.x_m - object.position.x_m) * c - (point.y_m - object.position.y_m) * s,
    y_m: object.position.y_m + (point.x_m - object.position.x_m) * s + (point.y_m - object.position.y_m) * c,
  });
  return { ...object, polygon: object.polygon?.map((ring) => ring.map(rotate)) };
}

export interface RectangleDimensions {
  width: number;
  length: number;
  rotation: number;
  center: MetricPoint;
  winding: number;
  closed: boolean;
}

/** Editing dimensions must never silently replace an irregular outline or a hole. */
export function rectangleDimensions(landmark: LotLandmark): RectangleDimensions | null {
  if (landmark.polygon?.length !== 1) return null;
  const ring = landmark.polygon[0];
  const closed = ring.length === 5 && distance(ring[0], ring[4]) < EPSILON;
  const points = closed ? ring.slice(0, 4) : ring;
  if (points.length !== 4) return null;
  const [a, b, c, d] = points;
  const ux = b.x_m - a.x_m, uy = b.y_m - a.y_m;
  const vx = c.x_m - b.x_m, vy = c.y_m - b.y_m;
  const width = Math.hypot(ux, uy), length = Math.hypot(vx, vy);
  if (width < EPSILON || length < EPSILON || Math.abs(ux * vx + uy * vy) > EPSILON * width * length) return null;
  if (Math.hypot(c.x_m - d.x_m - ux, c.y_m - d.y_m - uy) > EPSILON * width) return null;
  if (Math.hypot(d.x_m - a.x_m - vx, d.y_m - a.y_m - vy) > EPSILON * length) return null;
  return {
    width, length, rotation: Math.atan2(uy, ux) * 180 / Math.PI,
    center: { x_m: (a.x_m + c.x_m) / 2, y_m: (a.y_m + c.y_m) / 2 },
    winding: Math.sign(ux * vy - uy * vx), closed,
  };
}

export function resizeRectangle(landmark: LotLandmark, width: number, length: number, rotation: number): LotLandmark {
  const rectangle = rectangleDimensions(landmark);
  if (!rectangle) throw new Error('รูปทรงนี้ไม่ใช่สี่เหลี่ยมผืนผ้า ให้แก้จุดมุมบนแผนผัง');
  if (![width, length, rotation].every(Number.isFinite) || width <= 0 || length <= 0) throw new Error('ความกว้างและความยาวต้องมากกว่า 0');
  const angle = rotation * Math.PI / 180;
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const vx = -uy * rectangle.winding, vy = ux * rectangle.winding;
  const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({
    x_m: rectangle.center.x_m + x * width / 2 * ux + y * length / 2 * vx,
    y_m: rectangle.center.y_m + x * width / 2 * uy + y * length / 2 * vy,
  }));
  if (rectangle.closed) ring.push({ ...ring[0] });
  return { ...landmark, polygon: [ring] };
}

export function moveLandmark(landmark: LotLandmark, position: MetricPoint): LotLandmark {
  if (![position.x_m, position.y_m].every(Number.isFinite)) throw new Error('พิกัดต้องเป็นตัวเลขที่มีค่าจำกัด');
  const dx = position.x_m - landmark.position.x_m, dy = position.y_m - landmark.position.y_m;
  if (!dx && !dy) return landmark;
  const move = (point: MetricPoint): MetricPoint => ({ x_m: point.x_m + dx, y_m: point.y_m + dy });
  return {
    ...landmark, position,
    ...(landmark.polygon ? { polygon: landmark.polygon.map((ring) => ring.map(move)) } : {}),
    ...(landmark.line ? { line: landmark.line.map(move) } : {}),
  };
}

export function moveVertex(landmark: LotLandmark, ringIndex: number, vertexIndex: number, point: MetricPoint): LotLandmark {
  if (!landmark.polygon?.[ringIndex]?.[vertexIndex]) throw new Error('ไม่พบจุดมุมที่เลือก');
  if (![point.x_m, point.y_m].every(Number.isFinite)) throw new Error('พิกัดต้องเป็นตัวเลขที่มีค่าจำกัด');
  const polygon = landmark.polygon.map((ring) => ring.map((p) => ({ ...p })));
  const ring = polygon[ringIndex];
  const wasClosed = distance(ring[0], ring[ring.length - 1]) < EPSILON;
  ring[vertexIndex] = point;
  if (wasClosed && vertexIndex === 0) ring[ring.length - 1] = { ...point };
  if (wasClosed && vertexIndex === ring.length - 1) ring[0] = { ...point };
  return { ...landmark, polygon };
}

export function editableVertices(ring: MetricPoint[]): MetricPoint[] {
  return ring.length > 3 && distance(ring[0], ring[ring.length - 1]) < EPSILON ? ring.slice(0, -1) : ring;
}

function editRing(landmark: LotLandmark, ringIndex: number, edit: (points: MetricPoint[]) => MetricPoint[]): LotLandmark {
  const ring = landmark.polygon?.[ringIndex];
  if (!ring) throw new Error('ไม่พบขอบเขตที่เลือก');
  const vertices = editableVertices(ring);
  const next = edit(vertices.map((p) => ({ ...p })));
  if (vertices.length !== ring.length) next.push({ ...next[0] });
  return { ...landmark, polygon: landmark.polygon!.map((current, index) => index === ringIndex ? next : current) };
}

export function insertVertex(landmark: LotLandmark, ringIndex: number, after: number): LotLandmark {
  return editRing(landmark, ringIndex, (points) => {
    const a = points[after], b = points[(after + 1) % points.length];
    if (!a || !b) throw new Error('ไม่พบจุดมุมที่เลือก');
    points.splice(after + 1, 0, { x_m: a.x_m / 2 + b.x_m / 2, y_m: a.y_m / 2 + b.y_m / 2 });
    return points;
  });
}

export function removeVertex(landmark: LotLandmark, ringIndex: number, vertex: number): LotLandmark {
  return editRing(landmark, ringIndex, (points) => {
    if (points.length <= 3 || !points[vertex]) throw new Error('รูปหลายเหลี่ยมต้องเหลืออย่างน้อย 3 จุด');
    return points.filter((_, index) => index !== vertex);
  });
}

export const LANDMARK_NAMES: Record<LandmarkKind, string> = {
  TREE: 'ต้นไม้', ROAD: 'ถนน', WALKWAY: 'ทางเดิน', PLANTING: 'แปลงต้นไม้', SHELTER: 'ทางเดินมีหลังคา',
  BUILDING: 'อาคาร', GUARD_BOOTH: 'ป้อมยาม', AISLE: 'ทางสัญจร', BARRIER: 'แนวกั้น',
  ENTRANCE: 'ทางเข้า', EXIT: 'ทางออก', ENTRANCE_EXIT: 'ทางเข้า–ออก',
};

export const LANDMARK_COLORS: Record<LandmarkKind, string> = {
  TREE: '#75937e', ROAD: '#a1a7b0', WALKWAY: '#d4c7ac', PLANTING: '#a8b99e', SHELTER: '#929bb0',
  BUILDING: '#d0c6bf', GUARD_BOOTH: '#b2a99b', AISLE: '#c4c9ce', BARRIER: '#767b87',
  ENTRANCE: '#849bb5', EXIT: '#849bb5', ENTRANCE_EXIT: '#849bb5',
};

export function newLandmark(model: LotModelDefinition, kind: LandmarkKind, position: MetricPoint): LotLandmark {
  const ids = new Set((model.landmarks ?? []).map((landmark) => landmark.landmark_id));
  if (ids.size >= 100) throw new Error('หนึ่งแผนผังเพิ่มวัตถุได้ไม่เกิน 100 รายการ');
  const prefix = kind.toLowerCase().replaceAll('_', '-');
  let number = 1;
  while (ids.has(`${prefix}-${number}`)) number++;
  const base: LotLandmark = { landmark_id: `${prefix}-${number}`, kind, position, measurement_source: 'ESTIMATED' };
  if (kind === 'TREE') return { ...base, height_m: 6, radius_m: 2 };
  if (kind === 'BARRIER') return { ...base, line: [{ x_m: position.x_m - 2, y_m: position.y_m }, { x_m: position.x_m + 2, y_m: position.y_m }] };
  if (kind === 'ENTRANCE' || kind === 'EXIT' || kind === 'ENTRANCE_EXIT') return base;
  const width = kind === 'ROAD' ? 6 : kind === 'BUILDING' ? 8 : 2;
  const length = kind === 'ROAD' ? 20 : 10;
  const x = position.x_m, y = position.y_m;
  return {
    ...base,
    polygon: [[{ x_m: x - width / 2, y_m: y - length / 2 }, { x_m: x + width / 2, y_m: y - length / 2 },
      { x_m: x + width / 2, y_m: y + length / 2 }, { x_m: x - width / 2, y_m: y + length / 2 }]],
    ...(['BUILDING', 'GUARD_BOOTH', 'SHELTER'].includes(kind) ? { height_m: 3 } : {}),
    ...(kind === 'PLANTING' ? { height_m: 0.5 } : {}),
  };
}

export function modelBounds(model: LotModelDefinition) {
  const points = [...model.outline.flat(), ...model.parking_areas.flatMap((area) => area.polygon.flat()),
    ...(model.landmarks ?? []).flatMap((landmark) => {
      const r = landmark.radius_m ?? 0;
      return [...(landmark.polygon?.flat() ?? []), ...(landmark.line ?? []),
        { x_m: landmark.position.x_m - r, y_m: landmark.position.y_m - r },
        { x_m: landmark.position.x_m + r, y_m: landmark.position.y_m + r }];
    })];
  return {
    minX: Math.min(...points.map((p) => p.x_m)), maxX: Math.max(...points.map((p) => p.x_m)),
    minY: Math.min(...points.map((p) => p.y_m)), maxY: Math.max(...points.map((p) => p.y_m)),
  };
}
