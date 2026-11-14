"""Visible ground patches and width witnesses, never object-mask footprints."""

from dataclasses import dataclass
from itertools import pairwise

import numpy as np
from shapely.affinity import rotate, translate
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from app.services.ground_plane_homography_service import transform_point
from app.services.virtual_fitting_service import _row_angle

MAX_WIDTH_SAMPLES = 128
AREA_EPSILON = 1e-10


def polygon_parts(shape):
    if shape.is_empty:
        return []
    if shape.geom_type == "Polygon":
        return [shape]
    return [part for child in getattr(shape, "geoms", []) for part in polygon_parts(child)]


def _lines(shape):
    if shape.is_empty:
        return []
    if shape.geom_type == "LineString":
        return [shape]
    return [part for child in getattr(shape, "geoms", []) for part in _lines(child)]


def transform_polygon(shape, matrix, *, image_bounds=False):
    """Preserve rings and reject horizons, out-of-frame ground, or invalid output."""
    output, signs = [], set()
    matrix = np.asarray(matrix, dtype=float)
    for ring in [shape.exterior, *shape.interiors]:
        points = []
        for x, y in ring.coords:
            denominator = matrix[2] @ np.array([x, y, 1.])
            if not np.isfinite(denominator) or abs(denominator) <= 1e-10:
                return None
            signs.add(denominator > 0)
            point = transform_point(x, y, matrix)
            if point is None or (image_bounds and not all(-1e-12 <= value <= 1+1e-12 for value in point)):
                return None
            points.append(point)
        output.append(points)
    if len(signs) != 1:
        return None
    result = Polygon(output[0], output[1:])
    return result if result.is_valid and result.area > 1e-12 else None


@dataclass(frozen=True)
class GroundPatch:
    geometry: Polygon
    visibility: str
    reasons: tuple[str, ...]


def visible_ground_patches(free, inverse, occluders, uncertainty):
    """Subtract silhouettes only from the image projection of known ground.

    Mapping the remaining visible ground back is a visibility partition. It never
    adds projected vehicle silhouettes to occupied geometry or infers hidden free
    space. Every failed round-trip retains the original part as unconfirmed.
    """
    try:
        matrix = np.linalg.inv(np.asarray(inverse, dtype=float))
    except (ValueError, np.linalg.LinAlgError):
        return [GroundPatch(part, "UNCONFIRMED", ("PROJECTION_OUTSIDE_VALID_IMAGE",)) for part in polygon_parts(free)]
    output = []
    for original in polygon_parts(free):
        image = transform_polygon(original, inverse, image_bounds=True)
        if image is None:
            output.append(GroundPatch(original, "UNCONFIRMED", ("PROJECTION_OUTSIDE_VALID_IMAGE",)))
            continue
        pending, failed = [], False
        for image_shape, visibility in [(image.difference(occluders), "VISIBLE"), (image.intersection(occluders), "OCCLUDED")]:
            for image_part in polygon_parts(image_shape):
                if image_part.area <= 1e-12:
                    continue
                ground = transform_polygon(image_part, matrix)
                if ground is None:
                    failed = True
                    break
                ground = ground.intersection(original)
                for part, uncertain in [(ground.difference(uncertainty), False), (ground.intersection(uncertainty), True)]:
                    for piece in polygon_parts(part):
                        if piece.area <= AREA_EPSILON:
                            continue
                        reasons = (["GROUND_MAY_BE_OCCLUDED"] if visibility == "OCCLUDED" else []) + (["LOCAL_ROW_UNCERTAINTY"] if uncertain else [])
                        pending.append(GroundPatch(piece, visibility, tuple(reasons)))
            if failed:
                break
        # Fail closed if floating-point operations omit meaningful ground.
        covered = unary_union([item.geometry for item in pending])
        if failed or original.symmetric_difference(covered).area > max(1e-8, original.area*1e-8):
            output.append(GroundPatch(original, "UNCONFIRMED", ("VISIBILITY_PARTITION_NOT_PROVEN",)))
        else:
            output.extend(pending)
    return output


@dataclass(frozen=True)
class WidthWitness:
    width_m: float
    upper_bound_m: float
    line: tuple
    depth_m: float
    depth_line: tuple


def patch_width_witness(shape, row):
    """Return a contained interior cross-section, not a bbox or full-vehicle fit.

    Midpoints between critical vertex heights avoid joining disconnected spans
    along a boundary. Sampling yields a proven width lower bound, never a claim
    that a wider cross-section cannot exist. Depth is measured at line midpoint.
    """
    angle, origin = _row_angle(row), row.centroid
    local = rotate(translate(shape, -origin.x, -origin.y), -angle, origin=(0, 0))
    left, bottom, right, top = local.bounds
    heights = sorted({y for ring in [local.exterior, *local.interiors] for _, y in ring.coords})
    samples = [(a+b)/2 for a, b in pairwise(heights) if b-a > 1e-9]
    if len(samples) > MAX_WIDTH_SAMPLES:
        samples = [samples[index] for index in np.linspace(0, len(samples)-1, MAX_WIDTH_SAMPLES, dtype=int)]
    best, best_y = None, None
    for y in samples:
        for segment in _lines(local.intersection(LineString([(left-1, y), (right+1, y)]))):
            if best is None or segment.length > best.length:
                best, best_y = segment, y
    if best is None or best.length <= 1e-9:
        return WidthWitness(0., right-left, (), 0., ())
    x1, _, x2, _ = best.bounds
    x = (x1+x2)/2
    depths = [line for line in _lines(local.intersection(LineString([(x, bottom-1), (x, top+1)]))) if line.distance(Point(x, best_y)) <= 1e-9]
    depth = max(depths, key=lambda line: line.length) if depths else None
    def world(coordinates):
        return tuple((point.x, point.y) for point in [rotate(translate(Point(a, b), origin.x, origin.y), angle, origin=(origin.x, origin.y)) for a, b in coordinates])
    return WidthWitness(best.length, right-left, world([(x1, best_y), (x2, best_y)]),
        depth.length if depth is not None else 0., world([depth.coords[0], depth.coords[-1]]) if depth is not None else ())
