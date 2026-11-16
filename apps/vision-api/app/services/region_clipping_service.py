"""Clip published display evidence without inventing availability outside its ROI."""

from shapely import get_parts
from shapely.geometry import Polygon

from app.models import LiveRegion, MetricGroundPoint, MetricPolygon


def polygon_shape(polygon: MetricPolygon) -> Polygon:
    rings = [[(point.x_m, point.y_m) for point in ring] for ring in polygon]
    return Polygon(rings[0], rings[1:])


def clip_regions(regions: list[LiveRegion], boundary) -> list[LiveRegion]:
    output = []
    for region in regions:
        original = polygon_shape(region.display_polygon or region.polygon)
        clipped = original.intersection(boundary)
        if original.equals(clipped):
            output.append(region)
            continue
        for part in get_parts(clipped):
            if not isinstance(part, Polygon) or part.area <= 1e-10:
                continue
            rings = [list(part.exterior.coords)[:-1], *[list(hole.coords)[:-1] for hole in part.interiors]]
            changes = {"display_polygon": [[MetricGroundPoint(x_m=x, y_m=y) for x, y in ring] for ring in rings]}
            # Original width/fitting evidence cannot certify a truncated fragment.
            if region.kind in {"AVAILABLE", "ALMOST_AVAILABLE"} and original.difference(clipped).area > 1e-8:
                changes.update(kind="UNKNOWN", width_m=None,
                               reasons=[*region.reasons, "ROI_CLIPPED_REQUIRES_RECHECK"])
            output.append(region.model_copy(update=changes))
    return output
