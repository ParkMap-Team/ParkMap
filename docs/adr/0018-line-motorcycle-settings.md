# 0018: Motorcycle settings in the LINE OA conversation

Status: accepted for the requested settings flow, 2026-11-15.

The settings rich-menu button starts a postback conversation. The OA offers
"ตั้งค่ารุ่นรถของฉัน", then the twelve requested model IDs and `other` (อื่นๆ).
The OA confirms only after the selected model has been committed for that account.
The setting is a preference; it does not select physical dimensions, modify
parking fitting, or identify a detected motorcycle.

## Decision

Run a separate `PARKMAP_PROCESS=bot` entrypoint in the existing Python project and
image (or the minimal Dockerfile.bot from the same lock). Its public surface is health and `/api/line/webhook`; it imports no vision
pipeline. Postgres remains owned by the Python project. Apply migrations through
the API before deploying the bot. No new package or browser identity flow is needed.

The bot verifies the HMAC signature over the exact request bytes before parsing
events. Only private user conversations participate. Account keys are SHA256
hashes of the verified webhook's LINE user ID; browser-supplied identity is never
accepted. Tokens, reply tokens, webhook bodies and LINE user IDs stay out of logs.
Known settings events older than seven days or more than five minutes ahead of
the server clock are rejected, so captured events cannot outlive receipt retention.
The channel secret and access token exist only in the bot's runtime environment,
not in LIFF, the API/worker configuration, Git, local env files or chat.

Keep one preference per account. Duplicate webhook event IDs do not repeat a
completed reply or overwrite a later choice. Persist a pending reply before
calling LINE, and mark it complete only after LINE accepts it; provider failures
return an error so redelivery can retry without losing the saved preference.
Older selection events cannot overwrite newer settings. Keep one preference until
it is replaced or erased by the team; erase preference data at project end. Event
receipts contain no raw LINE ID or reply token and are purged after seven days
in batches of at most 100 per request. Storage and the LINE call with bounded HTTP timeouts
run in a worker thread; a per-account lock serializes confirmation with later
selections without blocking the async request loop.

The rich-menu/bot protocol is `parkmap:settings`, `parkmap:vehicle`, and
`parkmap:vehicle:set:<model>`. The Python catalog is authoritative for model IDs;
the frontend menu only carries the entry command.

## Alternatives

A LIFF form with device storage is smaller but cannot provide the requested OA
reply and account persistence. LIFF `sendMessages` sends as the user, so it cannot
provide that OA confirmation either. Adding webhook routes to the vision API
would expose a process containing operator and inference endpoints and require
the OA token there. A dedicated process in the same Python project keeps those
credentials and public routes separate while reusing its deliberate database and
dependency configuration. The accepted cost is one additional Coolify process
and LINE webhook configuration.

Use the official Python LINE SDK v3 for signature verification, typed message
serialization and reply delivery. The SDK dependency is explicit and locked;
HTTP connect/read timeouts are five seconds with automatic transport retries
disabled (webhook redelivery owns retries). Settings open a pink ParkMap Flex
card. Model selection is a three-bubble carousel with five, five and three
postback buttons, retaining all thirteen choices and highlighting the saved
model. Confirmation remains a short text after the commit.
Postbacks and signature verification follow the official
[SDK](https://github.com/line/line-bot-sdk-python) and
[webhook](https://developers.line.biz/en/docs/messaging-api/receiving-messages)
contracts. This decision adds only signed-webhook preferences; ADR 0010's plate
registration and tracking remain proposed.
