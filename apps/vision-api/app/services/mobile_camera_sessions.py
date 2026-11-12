"""Single-API-process, short-lived phone capabilities. No raw frame storage on disk."""

import hashlib
import hmac
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any


class MobileSessionError(ValueError):
    def __init__(self, message="Session expired or unavailable", status=410):
        super().__init__(message)
        self.status = status


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


@dataclass
class MobileSession:
    id: str
    area: str
    camera: str
    calibration: str
    parking: dict
    expires: float
    pair_expires: float
    pair_hash: str
    access_hash: str = ""
    state: str = "PAIRING"
    preview_url: str = ""
    revision: int = 0
    preview_at: float = 0.
    sequence: int = -1
    last_frame: float = float("-inf")
    busy: bool = False
    last_state: Any = None
    result: dict = field(default_factory=dict)


class MobileSessions:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.lock = threading.RLock()
        self.items: dict[str, MobileSession] = {}
        self.analysis_lock = threading.Lock()

    def create(self, area, camera, calibration, parking):
        with self.lock:
            now = self.clock()
            self.items = {key: item for key, item in self.items.items() if item.expires > now and item.state != "STOPPED"}
            for item in self.items.values():
                if item.area == area:
                    self.stop(item.id)
            if len(self.items) >= 8:
                raise MobileSessionError("Too many sessions; stop another session first", 429)
            pair = secrets.token_urlsafe(32)
            item = MobileSession(secrets.token_urlsafe(18), area, camera, calibration, parking, now+1800, now+120, digest(pair))
            self.items[item.id] = item
            return item, pair

    def get(self, key):
        with self.lock:
            item = self.items.get(key)
            if item is None or item.expires <= self.clock() or item.state == "STOPPED":
                if item:
                    item.preview_url = ""
                raise MobileSessionError()
            return item

    def claim(self, pair):
        with self.lock:
            hashed = digest(pair)
            item = next((item for item in self.items.values() if hmac.compare_digest(item.pair_hash, hashed)), None)
            if item is None:
                raise MobileSessionError()
            self.get(item.id)
            if item.state != "PAIRING" or item.pair_expires <= self.clock():
                raise MobileSessionError()
            token = secrets.token_urlsafe(32)
            item.pair_hash = ""
            item.access_hash = digest(token)
            item.state = "AWAITING_PREVIEW"
            return token

    def authorize(self, token):
        with self.lock:
            hashed = digest(token)
            item = next((item for item in self.items.values() if item.access_hash and hmac.compare_digest(item.access_hash, hashed)), None)
            if item is None:
                raise MobileSessionError()
            return self.get(item.id)

    def begin_frame(self, token, sequence):
        with self.lock:
            item = self.authorize(token)
            if item.busy or self.clock()-item.last_frame < 2:
                raise MobileSessionError("Wait for the previous frame", 429)
            if sequence <= item.sequence:
                raise MobileSessionError("Old frame sequence", 409)
            item.sequence, item.last_frame, item.busy = sequence, self.clock(), True
            return item

    def end_frame(self, item):
        with self.lock:
            item.busy = False

    def preview(self, item, url, revision):
        with self.lock:
            self.get(item.id)
            item.preview_url, item.revision, item.preview_at = url, revision, self.clock()
            if item.state != "LIVE":
                item.state = "AWAITING_APPROVAL"

    def approve(self, key, revision):
        with self.lock:
            item = self.get(key)
            if item.state != "AWAITING_APPROVAL" or not item.preview_url or item.revision != revision or self.clock()-item.preview_at > 120:
                raise MobileSessionError("A recent matching preview must be reviewed first", 409)
            item.state = "LIVE"

    def stop(self, key):
        with self.lock:
            item = self.items.get(key)
            if item:
                item.state, item.access_hash, item.pair_hash, item.preview_url = "STOPPED", "", "", ""

    def owns_area(self, area):
        with self.lock:
            for item in self.items.values():
                if item.expires <= self.clock():
                    self.stop(item.id)
            return any(item.area == area and item.state == "LIVE" and item.expires > self.clock() for item in self.items.values())


mobile_sessions = MobileSessions()
