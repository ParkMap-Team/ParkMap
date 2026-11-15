# Motorcycle settings in LIFF

The settings tile opens /settings in LIFF. Users must choose one of twelve models or other before accessing a map. Existing saved preferences are retained per verified LINE account (same Provider). A save returns to the map; reopening settings allows changes. No OA confirmation or chat menu is sent.

See ADR 0019. The lightweight parkmap-bot resource now serves the account-preferences API at /api/line/preferences; its old webhook returns 404. Keep DATABASE_URL and set LINE_LOGIN_CHANNEL_ID=2011859796. Startup keeps its independent parkmap_line migration history. Messaging API credentials are unused and can be removed from this resource, without revoking the channel token used by menu administration.

LIFF runtime needs PARKMAP_SETTINGS_URL pointing to that internal resource on port 8000 and PARKMAP_PUBLIC_ORIGIN=https://app.parkmap.dev. NEXT_PUBLIC_LIFF_ID stays unchanged. The LIFF app must have openid enabled. Deploy settings service and LIFF, verify health and anonymous map/state/photo requests are refused, then publish the five URI rich menu. Preserve the previous menu for rollback. Disable Use webhook in LINE Console after rollout; the retired endpoint accepts no events regardless of that switch.

Verify in LINE on a phone: first-time account is prompted, cannot bypass with a direct map link, can save and view the map, and can reopen settings. A second account must have its own preference. Failed verification or storage must not unlock a map. Help and mobile-camera pairing remain independent. No database rows are dropped as part of this change.
