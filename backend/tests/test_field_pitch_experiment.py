from app.services.field_pitch_experiment_service import FIELD_PARKING_PITCH_WIDTH_M, FIELD_MOTORCYCLE_LENGTH_M, calculate_field_pitch_experiment
from shapely.geometry import Polygon


def test_field_pitch_is_unrounded_and_experimental():
    assert FIELD_PARKING_PITCH_WIDTH_M == 0.66
    assert FIELD_MOTORCYCLE_LENGTH_M == 2.0
    result = calculate_field_pitch_experiment([("row_4", Polygon([(0, 0), (18, 0), (18, 2), (0, 2)]))], [], {})
    assert result["provenance"] == "FIELD_OBSERVATION_EXPERIMENTAL"
    assert result["width_m"] == 0.66
    assert result["length_m"] == 2.0
    assert result["rows"][0]["capacity"] == result["rows"][0]["witness_count"]
