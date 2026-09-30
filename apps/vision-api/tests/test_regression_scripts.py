"""Isolated tests for dynamic-row regression reporting helpers."""

import pytest

from scripts.regression_multi_image_parking import _runtime_row_ids
from scripts.regression_parking_analysis import _authoritative_row_areas, _ordered_row_ids


def _analysis(row_ids: list[str]) -> dict:
    rows = [{"row_id": row_id, "polygon": [{"x_m": 0, "y_m": 0}, {"x_m": 1, "y_m": 0}, {"x_m": 1, "y_m": 2}, {"x_m": 0, "y_m": 2}], "area_m2": 2.0} for row_id in row_ids]
    return {"physical_map": {"rows": rows}, "free_space": {"rows": [{"row_id": row_id, "row_area_m2": 2.0} for row_id in row_ids]}}


@pytest.mark.parametrize("row_ids", [["row_1"], ["row_1", "row_2", "row_3"], [f"row_{i}" for i in range(1, 6)], [f"row_{i}" for i in range(1, 9)], ["row_1", "row_2", "row_10"]])
def test_regression_helpers_report_all_rows_in_numeric_order(row_ids: list[str]) -> None:
    analysis = _analysis(row_ids)
    expected = sorted(row_ids, key=lambda value: int(value.split("_")[1]))
    assert _ordered_row_ids(analysis) == expected
    assert _runtime_row_ids(analysis) == expected
    assert _authoritative_row_areas(analysis, expected) == {row_id: 2.0 for row_id in expected}


def test_regression_helpers_preserve_sparse_ids_without_inventing_rows() -> None:
    analysis = _analysis(["row_1", "row_2", "row_4", "row_10"])
    expected = ["row_1", "row_2", "row_4", "row_10"]
    assert _ordered_row_ids(analysis) == expected
    assert _runtime_row_ids(analysis) == expected
    assert "row_3" not in _ordered_row_ids(analysis)
