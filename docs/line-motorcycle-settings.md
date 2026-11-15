# LINE motorcycle settings

The settings tile now sends a postback in the private OA chat:

1. ตั้งค่า
2. ตั้งค่ารุ่นรถของฉัน
3. Choose `click`, `aerox`, `nmax`, `scoopy`, `wave`, `pcx`, `fino`, `forza`,
   `grand_filano`, `hd_road_glide`, `cbr650r`, `xmax`, or `other` (อื่นๆ).
4. The bot commits the preference, then replies
   "ตั้งค่ารุ่นรถของคุณเป็น <รุ่นที่เลือก> เรียบร้อยแล้ว".

Opening the model menu again shows the current selection. The choice is scoped
to the verified LINE account and survives bot restarts. It is not used as a
physical measurement or a parking fitting input. The existing rich-menu image
and tap areas do not change. See [ADR 0018](adr/0018-line-motorcycle-settings.md).

The bot uses the official `line-bot-sdk` v3. Settings open a branded Flex card;
the thirteen model choices appear in three horizontally scrollable cards, with
the saved choice highlighted. The postback IDs and account persistence stay the
same. A successful save returns a short text confirmation.

## Deploy before publishing the rich menu

The existing Coolify application is `parkmap-bot` (UUID
`svalht0ztkvtlwifegi9n9ly`). Source releases use the
`release/line-motorcycle-settings` branch, pinned to a reviewed commit, with
manual deployment. The bot is independent of the vision API release.

1. Back up Postgres before changing the bot schema. Build
   `apps/vision-api/Dockerfile.bot` with context `apps/vision-api`.
   It installs only the locked `line-bot` dependency group, without inference
   libraries or camera/model mounts. Expose port 8000 and check `/api/health`.
2. Set runtime-only `DATABASE_URL`, `LINE_CHANNEL_SECRET` and
   `LINE_CHANNEL_ACCESS_TOKEN`. Disable build-time injection. Use the OA's
   Messaging API channel (2011859803), not its LIFF LINE Login channel.
   Credentials go directly into Coolify, never chat, Git or local env files.
3. Startup runs `python -m app.db.line_migrations`, then starts the webhook.
   The bot owns `parkmap_line` and its own Alembic version table, protected by
   a transaction advisory lock. Its DB role needs schema creation/ownership for
   startup migrations. The existing API migration history is untouched; the API
   needs no rebuild or deployment. Retain the additive schema on rollback.
4. Route `https://app.parkmap.dev/api/line` and
   `https://app.parkmap.dev/api/health` to this bot in Coolify, with prefix
   stripping disabled. The root LIFF route continues to use its own process.
   Register `https://app.parkmap.dev/api/line/webhook` in the Messaging API
   channel, verify it, and enable webhooks and webhook redelivery. Do not replace
   another integration's webhook without reconciling its routing first.
5. Once the bot is healthy and webhook verification succeeds, run
   `pnpm --dir apps/liff rich-menu` with `LINE_BOT_HEALTH_URL` set to
   `https://app.parkmap.dev/api/health`, the production LIFF ID, and the
   access token supplied only to that shell. The publisher checks bot readiness
   before any LINE request. It replaces the default menu and deletes previous
   API-created menus; LIFF restarts alone never update the LINE menu.
6. Verify on a phone: open settings, choose a model, check the OA confirmation,
   reopen settings, change the choice, and check isolation with a second account.

The main CI workflow deploys API, worker and LIFF only. Release this bot explicitly.

## Local verification

The bot entrypoint is `app.line_bot:app`. It does not load local env files for
Messaging API credentials. Supply bot-only variables in the shell or service
runtime, and run from `apps/vision-api`:

```sh
uv run python -m app.db.line_migrations
uv run uvicorn app.line_bot:app --host 127.0.0.1 --port 8002
```

The focused tests use synthetic LINE identities and an in-process provider
adapter, with no real LINE requests. Start only the disposable test database
and set `PARKMAP_TEST_DATABASE_URL` before running:

```sh
docker compose up -d postgres-test
# In apps/vision-api, with the test DB URL in the shell:
uv run python -m pytest -q tests/test_line_bot.py tests/test_line_flex.py tests/test_line_migrations.py
```

The webhook accepts at most 1 MiB and 100 events. It verifies the exact raw-body
signature before JSON parsing, ignores group/unrelated events, and validates
model IDs before storage. Preferences store SHA256 account keys, not raw LINE
user IDs. Reply tokens are not stored. One preference remains until replacement
or team erasure; remove preference data at project end. Old event receipts are
removed in batches of at most 100 on incoming events once older than seven days.
Settings events older than seven days or more than five minutes in the future
are rejected before storage; keep the server clock synchronized.
Completed events are not replied to twice. Pending replies are retried on LINE
redelivery, and late selections cannot overwrite a more recent model choice.
