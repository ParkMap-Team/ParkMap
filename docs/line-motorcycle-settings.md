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

A `parkmap-bot` draft was prepared in the shared Coolify production environment
on 2026-11-15. It has no domain or deployment, auto-deployment is disabled, and
its database URL still needs configuration. LINE credentials were entered by the
owner and presence-checked on 2026-11-15, without printing their values; actual
provider acceptance still requires verification. Reuse that draft.
Its source is the feature branch's `HEAD`; publish/release the new code and pin
the intended release commit before deployment. Saving credentials alone does
not activate this feature.

1. Back up Postgres, build the updated `apps/vision-api` image, and deploy the API
   first so migration `0006_line_motorcycle_settings` creates the two bot tables.
   Existing parking data is preserved. Image rollback does not downgrade this
   migration; retain the additive tables when rolling back.
2. Reuse the draft or create a separate Coolify application `parkmap-bot` from that
   same image/version. Set `PARKMAP_PROCESS=bot`, expose internal port `8000`, and
   check `GET /api/health`. No photo, model or camera mounts are needed.
3. Set these variables only in the bot's **runtime** environment, with build-time
   injection disabled:
   - `DATABASE_URL`: Postgres connection. A dedicated role needs schema usage
     and SELECT/INSERT/UPDATE/DELETE on `parkmap.line_motorcycle_preferences` and
     `parkmap.line_webhook_receipts` only; migrations run under the API role.
   - `LINE_CHANNEL_SECRET`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   Both LINE credentials must come from the OA's **Messaging API channel** used
   by the rich-menu script, not the LIFF LINE Login channel. Enter them directly
   in Coolify; never paste them into chat or persist them in local env files.
4. Give only the bot a public HTTPS origin. Register
   `https://<bot-domain>/api/line/webhook` in the Messaging API channel. Verify
   the webhook, enable webhooks, and enable webhook redelivery for provider
   retry handling. Keep the vision API internal. Do not replace a webhook
   belonging to another integration without first reconciling that routing.
5. Once the bot is healthy and webhook verification succeeds, publish the new
   menu with `pnpm --dir apps/liff rich-menu`, setting `LINE_BOT_HEALTH_URL` to
   `https://<bot-domain>/api/health`, the production LIFF ID, and a channel access
   token supplied only to that shell, as documented in the
   [LIFF README](../apps/liff/README.md#rich-menu). This replaces the channel's
   default menu and deletes its previous API-created menus. The publisher checks
   the bot's ready service marker before making any LINE API request.
6. In LINE on a phone, select a model, check the OA confirmation, reopen settings,
   change the choice, and repeat with a second account to confirm isolation.

The current source pins in Coolify are release-specific. Update the API and bot
to the new source commit/image rather than reusing the old deployed commit.
The existing `main` workflow deploys API, worker and LIFF only; a newly created
bot must be released explicitly with the matching API image. Publishing only
the rich menu leaves settings without a handler. Changing its action requires
the menu script; restarting the LIFF app alone does not update LINE's menu.

## Local verification

The bot entrypoint is `app.line_bot:app`. It does not load local env files for
Messaging API credentials. Supply bot-only variables in the shell or service
runtime, and run from `apps/vision-api`:

```sh
uv run uvicorn app.line_bot:app --host 127.0.0.1 --port 8002
```

The focused tests use synthetic LINE identities and an in-process provider
adapter, with no real LINE requests. Start only the disposable test database
and set `PARKMAP_TEST_DATABASE_URL` before running:

```sh
docker compose up -d postgres-test
# In apps/vision-api, with the test DB URL in the shell:
uv run python -m pytest -q tests/test_line_bot.py tests/test_line_flex.py
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
