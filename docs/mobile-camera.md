# Phone camera pairing (local development)

The phone page lives in LIFF at `/mobile-camera`; operator pairing/review lives
in Calibration UI, Setup > Mobile camera / QR. Only LIFF's scoped public camera
proxy needs HTTPS access. Never tunnel Calibration UI or the Vision API directly.
The phone never receives an editor or worker credential.

## Start

1. Run the usual local API, LIFF and Calibration UI. Use the currently configured
   local Seg model and register the matching camera calibration/lot ROI.
2. Provide an HTTPS origin for LIFF port 3001. With explicit permission to expose
   the student service, `tools/start-mobile-camera.ps1 -AllowPublicAccess` runs a
   Cloudflare Quick Tunnel. Install `cloudflared` first or pass its full path with
   `-CloudflaredPath`. The entire LIFF service is reachable through that link;
   this command is never run automatically by start-dev.
   When using Next's development server, set `DEV_TUNNEL_HOST` to the HTTPS
   hostname (without `https://`) and restart LIFF so its development-origin
   checks allow the phone connection. Keep the API and Calibration UI local.
3. In Setup > Mobile camera / QR, enter that HTTPS origin and the parking area ID,
   then create a QR. Open the scanned link in Safari/Chrome, allow the rear camera,
   and place the phone on a fixed mount in landscape orientation.
4. Review the phone image against the saved row polygons on the computer. Confirm
   the camera/lens/viewpoint matches the calibration, then explicitly approve.
   A different viewpoint needs its own calibration; this feature does not detect
   or correct phone motion automatically.
5. The phone sends the newest frame only, after the previous request completes.
   Python uses the same frame analysis service as the worker and publishes
   `LIVE_CAMERA` state. Sufficient-width green remains an experimental preview.

The QR's random pairing capability is in a URL fragment, removed from the
address bar when the user connects. It is single-use and expires after two minutes.
The claimed upload capability stays in browser memory only, expires after thirty
minutes, and may be revoked from either device. Restarting the API revokes all
sessions; run a single API process for this in-memory development feature.

## Processing and freshness

Preview-only frames never run inference or publish state. Approval binds the
session to the saved calibration fingerprint and exact reviewed preview revision.
Frames use server-received timestamps, checked again after analysis. Changed
calibration, out-of-order frames, concurrent uploads, oversized/corrupt frames and
aspect-ratio changes are rejected. Matching aspect ratios may be resized to the
reference resolution without cropping; resolution equality alone never proves
the camera viewpoint matches.

Only one inference request runs at a time. While an approved phone session owns
an area, background worker publications for that area are acknowledged but not
stored. When phone frames stop, LIFF's existing freshness rules hide old regions;
the photo worker does not silently replace a disconnected phone until the session
is stopped or expires. Explicit Stop revokes the capability and clears the last
phone regions before worker publications may resume.

Raw image bytes are processed in memory, not uploaded through disk-spooling
multipart handling, and never persisted as files or video. The operator sees
only the latest thumbnail; it is cleared on Stop/expiry. Derived parking states
follow the normal DB retention policy. HTTPS hosting/tunnel providers transport
the upload; use only an approved provider for team footage.

## Checks

From `apps/vision-api`: `uv run --no-sync pytest tests/test_mobile_camera_sessions.py tests/test_mobile_camera_api.py`.
From `apps/liff`: `node --experimental-strip-types --test src/lib/mobile-camera-proxy.test.ts`.
From `tools/calibration-ui`: `node scripts/test-mobile-camera-ui.mjs` runs a local
headless browser with a generated grey fake camera. It tests pairing, browser
permission, preview/review gating, URL-fragment cleanup and Stop; it never approves
the fake footage for publication. Real phone/network/camera alignment still needs
an operator test over the chosen HTTPS origin.

References: [getUserMedia secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
