# Scoped mobile camera pairing

Status: accepted for local development, 2026-11-11.

The operator requests QR pairing from a phone camera into the existing Python
Seg and LIFF state pipeline. We choose serial HTTP image uploads rather than a
WebRTC/media server: inference is slower than video, and a single latest frame
fits the existing analysis and freshness boundaries without another broker.

Calibration UI remains loopback-only and creates/revokes sessions through the
editor-authenticated server proxy. The separate LIFF `/mobile-camera` page and
four allowlisted phone proxy operations may be served over an explicitly approved
HTTPS origin. No editor/worker credential reaches the phone. A random one-use
pair capability lasts two minutes; its claimed phone capability lasts thirty
minutes in memory only. Restarting the API revokes everything. This implementation
requires one API process; it is not a multi-replica production session store.

Phone frames do not run inference or publish until an operator approves a recent
preview revision against the saved image rows. The fingerprint is pinned and
rechecked during processing. Same-aspect frames may be resized to reference
resolution without cropping; a fixed matching camera/lens/viewpoint remains an
operator responsibility. Camera motion is not automatically corrected.

The phone and worker use the shared Python frame analysis service. A phone owns
its parking area's publication while approved; background worker writes are
acknowledged but not stored until Stop/expiry. In-flight work is re-authorized
before persistence, so revocation cannot publish a late result. Upload timing is
server-owned and includes transfer/analysis latency. Existing freshness,
calibration/lot placement, uncertainty and width-preview semantics remain.

Raw frames avoid multipart disk spooling and are not persisted; only the latest
operator thumbnail is held in memory. Stop/expiry clears it. Derived states use
normal retention. Opening an HTTPS tunnel is explicit, never automatic; tunneling
the whole LIFF service makes its student pages/state publicly reachable too.
The gateway/provider must be approved for team footage. See
[mobile-camera.md](../mobile-camera.md) for setup, checks and remaining real-device
verification.
