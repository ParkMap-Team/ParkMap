from shapely.geometry import Polygon

from app.services.capacity_service import calculate_row_capacity


def rect(width, depth=2.0):
    return Polygon([(0, 0), (width, 0), (width, depth), (0, depth)])


def test_capacity_empty_rows_uses_simultaneous_witnesses():
    for width, expected in ((0.66, 1), (1.32, 2), (1.98, 3), (15.0, 22), (18.0, 27)):
        result = calculate_row_capacity("row", rect(width), rect(width))
        assert result["capacity"] == expected
        assert len(result["placements"]) == expected
        assert result["validation"]["valid"]


def test_capacity_does_not_use_area_alone():
    fragmented = rect(0.6).union(Polygon([(1.0, 0), (1.6, 0), (1.6, 2), (1.0, 2)]))
    result = calculate_row_capacity("row", rect(1.7), fragmented)
    assert result["capacity"] == 0


def test_capacity_is_deterministic():
    geometry = rect(4)
    first = calculate_row_capacity("row", geometry, geometry)
    second = calculate_row_capacity("row", geometry, geometry)
    assert first == second


def test_no_fit_authoritative_geometry_forces_zero_capacity():
    result = calculate_row_capacity("row", rect(18), rect(18))
    assert result["capacity"] > 0
    from app.services.capacity_service import calculate_capacity
    guarded = calculate_capacity([("row", rect(18))], {"row": rect(18)}, {"rows": [{"row_id": "row", "status": "NO_FIT"}]})
    assert guarded["rows"][0]["capacity"] == 0
    assert guarded["rows"][0]["placements"] == []
