import pytest
from shapely.geometry import box

from app.models import LiveRegion, MetricGroundPoint
from app.services.region_clipping_service import clip_regions, polygon_shape


def rectangle(x0, y0, x1, y1):
    return [[MetricGroundPoint(x_m=x, y_m=y) for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]]


@pytest.mark.parametrize("kind", ["AVAILABLE", "ALMOST_AVAILABLE"])
def test_clipping_does_not_reuse_width_or_fitting_for_partial_fragment(kind):
    region = LiveRegion(kind=kind, row_id="r", polygon=rectangle(-1, 0, 2, 2), width_m=3)
    result = clip_regions([region], box(0, 0, 1, 2))
    assert len(result) == 1
    assert result[0].kind == "UNKNOWN"
    assert result[0].width_m is None
    assert "ROI_CLIPPED_REQUIRES_RECHECK" in result[0].reasons
    assert region.kind == kind


def test_split_occupied_fragments_keep_one_detection_and_exclude_boundary_hole():
    boundary = box(0, 0, 4, 2).difference(box(1, -1, 2, 3))
    region = LiveRegion(kind="OCCUPIED", detection_id="d1", row_id="r", polygon=rectangle(-1, 0, 5, 2))
    result = clip_regions([region], boundary)
    assert len(result) == 2
    assert {r.detection_id for r in result} == {"d1"}
    assert all(boundary.covers(polygon_shape(r.display_polygon)) for r in result)
    assert sum(polygon_shape(r.display_polygon).area for r in result) == pytest.approx(6)
    assert all(r.polygon == region.polygon for r in result)


def test_outside_regions_disappear_and_unchanged_width_evidence_keeps_its_semantics():
    green = LiveRegion(kind="WIDTH_SUFFICIENT", polygon=rectangle(0, 0, 1, 1), width_m=1)
    outside = LiveRegion(kind="OCCUPIED", detection_id="d2", polygon=rectangle(3, 3, 4, 4))
    assert clip_regions([green, outside], box(0, 0, 2, 2)) == [green]


def test_width_analysis_is_preserved_while_only_display_shape_is_clipped():
    region = LiveRegion(kind="WIDTH_SUFFICIENT", row_id="r", polygon=rectangle(-1, 0, 2, 2),
                        width_m=3, reasons=["GROUND_MAY_BE_OCCLUDED"])
    result = clip_regions([region], box(0, 0, 1, 2))
    assert len(result) == 1
    assert result[0].kind == "WIDTH_SUFFICIENT"
    assert result[0].width_m == 3
    assert result[0].polygon == region.polygon
    assert result[0].reasons == region.reasons
    assert polygon_shape(result[0].display_polygon).equals(box(0, 0, 1, 2))
