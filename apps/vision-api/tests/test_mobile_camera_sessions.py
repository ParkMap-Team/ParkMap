import pytest

from app.services.mobile_camera_sessions import MobileSessionError, MobileSessions


def test_pairing_is_one_use_expiring_and_not_an_editor_credential():
    clock = [0.]
    sessions = MobileSessions(clock=lambda: clock[0])
    item, pair = sessions.create("area", "camera", "v1", {})
    token = sessions.claim(pair)
    assert token != pair
    assert sessions.authorize(token) is item
    with pytest.raises(MobileSessionError):
        sessions.claim(pair)
    with pytest.raises(MobileSessionError):
        sessions.authorize(pair)
    clock[0] = 1801
    with pytest.raises(MobileSessionError):
        sessions.authorize(token)


def test_live_requires_operator_preview_approval_and_revocation_stops_ownership():
    sessions = MobileSessions()
    item, pair = sessions.create("area", "camera", "v1", {})
    token = sessions.claim(pair)
    assert not sessions.owns_area("area")
    with pytest.raises(MobileSessionError):
        sessions.approve(item.id, 0)
    sessions.preview(item, "data:image/jpeg;base64,test", 1)
    sessions.preview(item, "data:image/jpeg;base64,new", 2)
    with pytest.raises(MobileSessionError):
        sessions.approve(item.id, 1)
    sessions.approve(item.id, 2)
    assert sessions.owns_area("area")
    sessions.stop(item.id)
    assert not sessions.owns_area("area")
    with pytest.raises(MobileSessionError):
        sessions.authorize(token)


def test_uploads_are_serial_rate_limited_and_reject_old_sequences():
    clock = [0.]
    sessions = MobileSessions(clock=lambda: clock[0])
    item, pair = sessions.create("area", "camera", "v1", {})
    token = sessions.claim(pair)
    assert sessions.begin_frame(token, 1) is item
    with pytest.raises(MobileSessionError):
        sessions.begin_frame(token, 2)
    sessions.end_frame(item)
    clock[0] = 4
    with pytest.raises(MobileSessionError):
        sessions.begin_frame(token, 1)
    assert sessions.begin_frame(token, 2) is item
    sessions.stop(item.id)
    with pytest.raises(MobileSessionError):
        sessions.preview(item, "image", 2)


def test_expired_pair_and_replacement_cannot_claim_or_publish():
    clock = [0.]
    sessions = MobileSessions(clock=lambda: clock[0])
    old, pair = sessions.create("area", "camera", "v1", {})
    clock[0] = 121
    with pytest.raises(MobileSessionError):
        sessions.claim(pair)
    sessions.create("area", "camera", "v2", {})
    assert old.state == "STOPPED"
