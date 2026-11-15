import json

from linebot.v3.messaging import Message, ReplyMessageRequest

from app.services.line_motorcycle_settings import models_message, settings_message


def actions(node):
    if isinstance(node, dict):
        if node.get("type") == "button":
            yield node["action"]
        for value in node.values():
            yield from actions(value)
    elif isinstance(node, list):
        for value in node:
            yield from actions(value)


def test_settings_is_a_flex_card_with_my_motorcycle_action():
    message = settings_message()
    assert message["type"] == "flex"
    assert list(actions(message))[0]["label"] == "ตั้งค่ารุ่นรถของฉัน"
    assert list(actions(message))[0]["data"] == "parkmap:vehicle"


def test_flex_model_cards_offer_all_models_once_and_show_saved_choice():
    message = models_message("pcx")
    assert message["type"] == "flex"
    assert len(message["contents"]["contents"]) == 3
    buttons = list(actions(message))
    assert [a["data"] for a in buttons] == ["parkmap:vehicle:set:" + model for model in
        ["click", "aerox", "nmax", "scoopy", "wave", "pcx", "fino", "forza",
         "grand_filano", "hd_road_glide", "cbr650r", "xmax", "other"]]
    assert buttons[-1]["label"] == "อื่นๆ"
    assert all(a["type"] == "postback" and len(a["label"]) <= 40 for a in buttons)
    assert "รุ่นปัจจุบัน: pcx" in json.dumps(message, ensure_ascii=False)
    assert len(json.dumps(message, ensure_ascii=False).encode()) < 30000


def test_official_sdk_preserves_flex_buttons_and_selected_model():
    for message in [settings_message(), models_message("hd_road_glide")]:
        request = ReplyMessageRequest(reply_token="synthetic-reply", messages=[Message.from_dict(message)])
        serialized = request.to_dict()["messages"][0]
        assert serialized == message
