"""Account preferences and OA messages, independent of parking geometry."""

import hashlib
import json
import re
import time
from dataclasses import dataclass, field

MODEL_LABELS = {
    "click": "click", "aerox": "aerox", "nmax": "nmax", "scoopy": "scoopy",
    "wave": "wave", "pcx": "pcx", "fino": "fino", "forza": "forza",
    "grand_filano": "grand_filano", "hd_road_glide": "hd_road_glide",
    "cbr650r": "cbr650r", "xmax": "xmax", "other": "อื่นๆ",
}
SETTINGS_COMMAND = "parkmap:settings"
MODELS_COMMAND = "parkmap:vehicle"
SELECT_PREFIX = "parkmap:vehicle:set:"


@dataclass(frozen=True)
class SettingsEvent:
    event_id: str
    account_key: str
    timestamp: int
    command: str
    reply_token: str = field(repr=False)

    @property
    def model(self) -> str | None:
        return self.command[len(SELECT_PREFIX):] if self.command.startswith(SELECT_PREFIX) else None

    @property
    def payload_hash(self) -> str:
        # Redelivery context and reply tokens may change; the actor and requested action may not.
        payload = json.dumps([self.account_key, self.timestamp, self.command], separators=(",", ":"))
        return hashlib.sha256(payload.encode()).hexdigest()


def parse_event(event: dict) -> SettingsEvent | None:
    source, postback = event.get("source"), event.get("postback")
    if (event.get("type") != "postback" or not isinstance(source, dict) or source.get("type") != "user"
            or not isinstance(postback, dict)):
        return None
    command = postback.get("data")
    if not isinstance(command, str) or (command not in {SETTINGS_COMMAND, MODELS_COMMAND}
                                       and not command.startswith(SELECT_PREFIX)):
        return None
    user_id = source.get("userId")
    reply_token, event_id, timestamp = event.get("replyToken"), event.get("webhookEventId"), event.get("timestamp")
    if (not isinstance(user_id, str) or not re.fullmatch(r"U[0-9a-f]{32}", user_id)
            or not isinstance(reply_token, str) or not 1 <= len(reply_token) <= 512
            or not isinstance(event_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", event_id)
            or type(timestamp) is not int or not 0 <= timestamp < 2**63
            or (command.startswith(SELECT_PREFIX) and command[len(SELECT_PREFIX):] not in MODEL_LABELS)):
        raise ValueError("Invalid webhook event")
    now_ms = time.time_ns() // 1_000_000
    if timestamp < now_ms - 7 * 86400 * 1000 or timestamp > now_ms + 5 * 60 * 1000:
        raise ValueError("Webhook event is outside the accepted time window")
    return SettingsEvent(event_id, hashlib.sha256(user_id.encode()).hexdigest(), timestamp, command, reply_token)


def model_button(label: str, data: str, *, selected: bool = False) -> dict:
    return {"type": "button", "style": "primary" if selected else "secondary",
            "color": "#DB2777" if selected else "#FCE7F3", "height": "sm", "action": {
        "type": "postback", "label": label, "data": data, "displayText": label,
    }}


def settings_message() -> dict:
    return flex_card("ตั้งค่า ParkMap", "จัดการข้อมูลรถของคุณ", [
        model_button("ตั้งค่ารุ่นรถของฉัน", MODELS_COMMAND, selected=True),
    ])


def flex_card(title: str, subtitle: str, buttons: list[dict]) -> dict:
    return {"type": "flex", "altText": f"{title} — {subtitle}", "contents": {
        "type": "bubble", "size": "mega",
        "header": {"type": "box", "layout": "vertical", "backgroundColor": "#831843",
                   "contents": [{"type": "text", "text": "PARKMAP", "color": "#FFFFFF",
                                 "weight": "bold", "size": "sm"}]},
        "body": {"type": "box", "layout": "vertical", "spacing": "md", "contents": [
            {"type": "text", "text": title, "weight": "bold", "size": "lg", "wrap": True},
            {"type": "text", "text": subtitle, "color": "#6B7280", "size": "sm", "wrap": True},
        ]},
        "footer": {"type": "box", "layout": "vertical", "spacing": "sm", "contents": buttons},
    }}


def models_message(current_model: str | None = None) -> dict:
    current = f"รุ่นปัจจุบัน: {MODEL_LABELS[current_model]}" if current_model in MODEL_LABELS else "ยังไม่ได้ตั้งค่ารุ่นรถ"
    models = list(MODEL_LABELS.items())
    bubbles = []
    for offset in range(0, len(models), 5):
        buttons = [model_button(label, SELECT_PREFIX + model, selected=model == current_model)
                   for model, label in models[offset:offset + 5]]
        card = flex_card("ตั้งค่ารุ่นรถของฉัน", f"{current}\nเลือกรุ่นรถ • {offset // 5 + 1}/3", buttons)
        bubbles.append(card["contents"])
    return {"type": "flex", "altText": f"ตั้งค่ารุ่นรถของฉัน — {current} — เลือกจาก 12 รุ่น หรืออื่นๆ",
            "contents": {"type": "carousel", "contents": bubbles}}


def confirmation_message(model: str) -> dict:
    return {"type": "text", "text": f"ตั้งค่ารุ่นรถของคุณเป็น {MODEL_LABELS[model]} เรียบร้อยแล้ว"}


def reply_message(event: SettingsEvent, current_model: str | None) -> dict:
    if event.command == SETTINGS_COMMAND:
        return settings_message()
    if event.command == MODELS_COMMAND or current_model is None:
        return models_message(current_model)
    if event.model == current_model:
        return confirmation_message(current_model)
    return {"type": "text", "text": f"คำขอนี้เก่ากว่าการตั้งค่าล่าสุด รุ่นรถปัจจุบันของคุณคือ {MODEL_LABELS[current_model]}"}
