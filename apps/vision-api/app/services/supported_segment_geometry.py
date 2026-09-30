"""Evidence-backed supported longitudinal segments for experimental rows."""

import math
from typing import Any


def build_supported_segments(
    row: dict[str, Any],
    anchors_by_id: dict[int, dict[str, Any]],
    *,
    scale_multiplier: float = 1.5,
    minimum_half_width: float = 0.01,
) -> list[dict[str, Any]]:
    """Build narrow segments from assigned anchors only.

    The row axis and local scale come from the existing V4/V5 evidence. Gaps
    are merged only when locally supported by neighboring scale; unsupported
    space is never turned into a segment.
    """
    centerline = row.get("centerline") or []
    if len(centerline) < 2:
        return []
    p0, p1 = centerline[0], centerline[1]
    dx, dy = p1["x"] - p0["x"], p1["y"] - p0["y"]
    length = math.hypot(dx, dy) or 1.0
    dx, dy = dx / length, dy / length
    intervals: list[tuple[float, float, int, float]] = []
    for anchor_id in row.get("anchor_ids", []):
        anchor = anchors_by_id.get(anchor_id)
        if not anchor:
            continue
        scale = max(float(anchor.get("local_scale", 0.01)), minimum_half_width / scale_multiplier)
        t = (anchor["x"] - p0["x"]) * dx + (anchor["y"] - p0["y"]) * dy
        half = max(scale * scale_multiplier, minimum_half_width)
        intervals.append((t - half, t + half, anchor_id, scale))
    intervals.sort(key=lambda item: (item[0], item[1], item[2]))
    merged: list[dict[str, Any]] = []
    for start, end, anchor_id, scale in intervals:
        if not merged or start > merged[-1]["longitudinal_end"] + max(scale, merged[-1]["max_scale"]):
            merged.append({"longitudinal_start": start, "longitudinal_end": end,
                           "anchor_ids": [anchor_id], "max_scale": scale})
        else:
            merged[-1]["longitudinal_end"] = max(merged[-1]["longitudinal_end"], end)
            merged[-1]["anchor_ids"].append(anchor_id)
            merged[-1]["max_scale"] = max(merged[-1]["max_scale"], scale)
    row_label = row.get("display_id") or row.get("row_id", "row")
    result = []
    for index, segment in enumerate(merged, 1):
        start, end = segment["longitudinal_start"], segment["longitudinal_end"]
        point = lambda t: {"x": max(0.0, min(1.0, p0["x"] + dx * t)),
                           "y": max(0.0, min(1.0, p0["y"] + dy * t))}
        result.append({"segment_id": f"{row_label}_segment_{index}",
                      "start": point(start), "end": point(end),
                      "anchor_ids": segment["anchor_ids"],
                      "longitudinal_start": start, "longitudinal_end": end,
                      "support_status": "SUPPORTED"})
    return result
