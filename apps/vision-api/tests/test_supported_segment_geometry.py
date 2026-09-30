from app.services.supported_segment_geometry import build_supported_segments


def row(ids=(1, 2)):
    return {"row_id": "row_1", "display_id": "R1",
            "centerline": [{"x": 0.1, "y": 0.5}, {"x": 0.9, "y": 0.5}],
            "anchor_ids": list(ids)}


def test_contiguous_evidence_forms_one_supported_segment():
    anchors = {1: {"x": 0.2, "y": 0.5, "local_scale": 0.03},
               2: {"x": 0.3, "y": 0.5, "local_scale": 0.03}}
    segments = build_supported_segments(row(), anchors)
    assert len(segments) == 1
    assert segments[0]["anchor_ids"] == [1, 2]
    assert segments[0]["support_status"] == "SUPPORTED"


def test_large_unsupported_gap_remains_two_segments():
    anchors = {1: {"x": 0.2, "y": 0.5, "local_scale": 0.02},
               2: {"x": 0.7, "y": 0.5, "local_scale": 0.02}}
    segments = build_supported_segments(row(), anchors)
    assert len(segments) == 2
    assert [s["anchor_ids"] for s in segments] == [[1], [2]]


def test_projection_handles_slanted_axis_and_missing_anchor():
    slanted = {"row_id": "row_2", "centerline": [{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.9}],
               "anchor_ids": [1, 99]}
    segments = build_supported_segments(slanted, {1: {"x": 0.3, "y": 0.3, "local_scale": 0.02}})
    assert len(segments) == 1
    assert segments[0]["anchor_ids"] == [1]
    assert segments[0]["start"]["x"] <= segments[0]["end"]["x"]


def test_small_locally_supported_gap_merges():
    anchors = {1: {"x": .2, "y": .5, "local_scale": .04}, 2: {"x": .28, "y": .5, "local_scale": .04}}
    assert len(build_supported_segments(row(), anchors)) == 1


def test_scale_variation_is_used_per_anchor():
    anchors = {1: {"x": .2, "y": .5, "local_scale": .01}, 2: {"x": .7, "y": .5, "local_scale": .08}}
    segments = build_supported_segments(row(), anchors)
    assert len(segments) == 2
    assert segments[1]["longitudinal_end"] - segments[1]["longitudinal_start"] > segments[0]["longitudinal_end"] - segments[0]["longitudinal_start"]


def test_empty_or_insufficient_evidence_is_conservative():
    assert build_supported_segments({"centerline": [], "anchor_ids": []}, {}) == []


def test_output_is_deterministic():
    anchors = {2: {"x": .3, "y": .5, "local_scale": .03}, 1: {"x": .2, "y": .5, "local_scale": .03}}
    assert build_supported_segments(row((2, 1)), anchors) == build_supported_segments(row((2, 1)), anchors)
