from shapely.geometry import Polygon

from app.services.virtual_fitting_service import LENGTH_M, WIDTH_M, fit_row, validate_witness


def rect(width, height):
    return Polygon([(0, 0), (width, 0), (width, height), (0, height)])


def test_empty_rows_fit():
    assert fit_row("row_18", rect(18, 2), rect(18, 2))["status"] == "FIT"
    assert fit_row("row_18", rect(18, 2), rect(18, 2))["validation"]["valid"]
    assert fit_row("row_15", rect(15, 2), rect(15, 2))["status"] == "FIT"


def test_narrow_or_shallow_free_region_does_not_fit():
    narrow = fit_row("row", rect(0.6, 10), rect(0.6, 10))
    shallow = fit_row("row", rect(10, 1.9), rect(10, 1.9))
    assert narrow["status"] == shallow["status"] == "NO_FIT"
    assert narrow["validation"]["valid"] and shallow["validation"]["valid"]


def test_exact_rectangle_fits_with_tolerance():
    result = fit_row("row", rect(WIDTH_M, LENGTH_M), rect(WIDTH_M, LENGTH_M))
    assert result["status"] == "FIT"
    assert result["validation"]["valid"]


def test_disconnected_components_and_hole_are_respected():
    components = rect(0.6, 2).union(Polygon([(2, 0), (4, 0), (4, 2), (2, 2)]))
    assert fit_row("row", rect(4, 2), components)["status"] == "FIT"
    fragmented = rect(0.6, 2).union(Polygon([(1, 0), (1.6, 0), (1.6, 2), (1, 2)]))
    result = fit_row("row", rect(1.7, 2), fragmented)
    assert result["status"] == "NO_FIT"
    assert result["validation"]["valid"]


def test_true_interior_hole_can_block_every_placement():
    outer = rect(3, 4)
    hole = Polygon([(0.3, 0.9), (2.7, 0.9), (2.7, 3.1), (0.3, 3.1)])
    free = outer.difference(hole)
    assert len(free.interiors) == 1
    result = fit_row("row", outer, free)
    assert result["status"] == "NO_FIT"
    assert result["validation"]["valid"]


def test_r1_like_boundary_witness_is_represented_as_fit():
    row = Polygon([(-0.25, -0.15), (7.25, -0.15), (7.25, 3.85), (-0.25, 3.85)])
    result = fit_row("row_1", row, row)
    assert result["status"] == "FIT"
    assert result["feasible_component_count"] >= 1
    assert result["validation"]["valid"]


def test_known_r1_witness_is_valid_and_generated_fit_is_valid():
    row = Polygon([
        (-0.2427799501886562, -0.1514901786483304),
        (7.757209876273694, -0.1514901786483304),
        (7.757209876273694, 3.84850982135167),
        (-0.2427799501886562, 3.84850982135167),
    ])
    x0, y0 = -0.2427799501886562, -0.1474556332290391
    witness = Polygon([
        (x0, y0),
        (x0 + WIDTH_M, y0),
        (x0 + WIDTH_M, y0 + LENGTH_M),
        (x0, y0 + LENGTH_M),
    ])
    assert abs(witness.area - 1.32) < 1e-6
    assert validate_witness(witness, row)
    result = fit_row("row_1", row, row)
    assert result["status"] != "NO_FIT"
