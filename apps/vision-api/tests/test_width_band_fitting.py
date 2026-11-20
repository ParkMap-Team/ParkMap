from shapely.geometry import Polygon, box

from app.services.width_band_fitting import covers, fit_slots


def test_a_slot_crosses_the_whole_depth_of_a_band_that_narrows():
    band = Polygon([(0, 0), (4, 0), (4, 2.4), (0, 2.6)])
    free = band.difference(box(0, -1, 2.5, 3)).difference(box(3.4, -1, 5, 3))
    slots = fit_slots(free, band, 0.8, 0)

    assert slots
    for slot in slots:
        left, bottom, right, top = slot.bounds
        assert covers(free, slot) and abs(right - left - 0.8) < 1e-9 and bottom == 0
        # The slot meets the sloping edge, so its depth is the band's own there, not a length.
        assert abs(top - (2.6 - 0.05 * left)) < 1e-9
    assert not fit_slots(free, band, 0.95, 0)



def test_a_hole_anywhere_across_the_depth_blocks_the_slot():
    band = box(0, 0, 5, 2.3)
    blocked = box(1.5, 0.7, 3, 1.4)
    free = band.difference(blocked)
    slots = fit_slots(free, band, 0.7, 0)
    assert any(slot.bounds[2] <= 1.5 for slot in slots) and any(slot.bounds[0] >= 3 for slot in slots)
    assert all(covers(free, slot) and slot.intersection(blocked).area == 0 for slot in slots)

