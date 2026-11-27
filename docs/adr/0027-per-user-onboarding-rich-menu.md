# 0027: Per-user onboarding rich menu

Accepted 2026-11-27 at the owner's request.

The Messaging API default rich menu remains the current five-action menu. A separate single-action onboarding menu is linked to a LINE user on a verified `follow` webhook when that account has no saved motorcycle model. `follow` includes both adding the Official Account and unblocking it. When a model already exists, the bot unlinks any per-user menu so the default menu is shown. After a successful model save, the bot also unlinks the per-user onboarding menu; the saved preference and current default menu remain authoritative.

The settings process accepts only signed LINE webhooks. It verifies `X-Line-Signature` against the raw bounded request body with the Messaging API channel secret before parsing events. It processes only `follow` events, validates the provider user ID, and uses it only in request memory for LINE's per-user rich-menu endpoint. Persistent account identity remains the existing SHA-256 hash; no raw user ID or webhook payload is stored or logged.

The current menu deployment creates the onboarding menu once, keeps it across later current-menu deployments, sets the current menu as default, and reports the onboarding rich-menu ID. Configure that ID as `LINE_ONBOARDING_RICH_MENU_ID` in the settings process before enabling the webhook. `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` stay in that process only. The webhook endpoint is `/api/line/webhook`; LINE Console configuration is an explicit deployment step. Existing followers receive no synthetic `follow` event and keep the current default menu until LINE sends a real follow event.

Sources: [LINE per-user rich menus](https://developers.line.biz/en/docs/messaging-api/use-per-user-rich-menus/), [LINE webhook signature verification](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/), and [LINE follow events](https://developers.line.biz/en/docs/messaging-api/receiving-messages/).
