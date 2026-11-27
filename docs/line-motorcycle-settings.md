# Motorcycle settings in LIFF

The settings tile opens /settings in LIFF. Users must choose one of twelve models or other before accessing a map. Existing saved preferences are retained per verified LINE account (same Provider). A save returns to the map; reopening settings allows changes. Each successful explicit save also attempts an OA text confirmation via the official Python LINE SDK. No chat settings menu is sent.

See ADR 0019 and [ADR 0027](adr/0027-per-user-onboarding-rich-menu.md). The lightweight parkmap-bot resource serves account preferences at `/api/line/preferences` and processes only signed follow events at `/api/line/webhook`; it has no chat settings flow. Keep `DATABASE_URL` and set `LINE_LOGIN_CHANNEL_ID=2011859796`. Startup keeps its independent `parkmap_line` migration history. The bot runtime needs `LINE_CHANNEL_ACCESS_TOKEN` for push confirmations and per-user rich-menu changes, `LINE_CHANNEL_SECRET` for webhook verification, and `LINE_ONBOARDING_RICH_MENU_ID` from the rich-menu deployment script. Keep these values in the bot process only. LINE Login and Messaging API must share the same Provider. A provider failure or timeout never rolls back the saved preference; `notification_status` reports accepted, failed, or not_configured. Accepted means LINE accepted the request, not proof of device delivery. Each explicit save attempts one push with a UUID retry key; reads/polls never send a notification, and there is no background retry queue.

## Onboarding rich menu

The Messaging API default remains the current five-action rich menu. On the signed `follow` event (new friend or unblock), the bot checks the account's saved preference. Accounts without a model receive the one-button onboarding menu. Accounts with a saved model have any per-user menu unlinked, revealing the current default. After a successful explicit save, the bot unlinks the onboarding menu so the current default appears immediately. LINE applies per-user menu changes immediately; the default menu remains the fallback.

Deploy and configure in this order:

1. Run the rich-menu deployment script. It creates the current default and onboarding menus, prints the onboarding menu ID, and preserves that menu on later runs.
2. Set the printed `LINE_ONBOARDING_RICH_MENU_ID`, `LINE_CHANNEL_SECRET`, and existing `LINE_CHANNEL_ACCESS_TOKEN` in the settings service runtime, then deploy/restart that service.
3. In the Messaging API channel, set the webhook URL to `https://<bot-domain>/api/line/webhook`, verify it, enable **Use webhook**, and enable webhook redelivery so transient settings-service or LINE API failures can be retried.
4. Test with a LINE account that has not saved a model: add the OA, open its one-button menu, save a model, and confirm the current menu appears. Also test an account with a saved model by blocking and unblocking the OA; it should return to the current menu.

Existing friends do not receive a synthetic follow event. They keep the current default menu until LINE sends a follow event, such as when they unblock and add the OA again.

LIFF runtime needs `PARKMAP_SETTINGS_URL` pointing to that internal resource on port 8000 and `PARKMAP_PUBLIC_ORIGIN=https://app.parkmap.dev`. `NEXT_PUBLIC_LIFF_ID` stays unchanged. The LIFF app must have `openid` enabled; enable `profile` too so the settings tab can show the rider's LINE name and picture. Keep **Use webhook** enabled after rollout; the signed follow webhook is required to assign onboarding menus to new friends and unblock events. The rich-menu deployment script sets the current five-action menu as the default and preserves the onboarding menu for per-user assignment.

Verify in LINE on a phone: first-time account is prompted, cannot bypass with a direct map link, can save and view the map, and can reopen settings. A second account must have its own preference. Failed verification or storage must not unlock a map. Help and mobile-camera pairing remain independent. No database rows are dropped as part of this change.

Identity failures emit fixed line_identity_rejected reason codes and provider HTTP status only. Tokens, user IDs and provider response bodies are never logged. Use timestamped reason codes to diagnose failed sign-in; HTTP 401 alone cannot distinguish expiry, audience/issuer/subject validation, or provider rejection.

Main deployment: Coolify source branches are main. While this PR is unmerged, retain the deployed immutable commit pins to prevent rollback to pre-settings code. After merge, advance LIFF/settings git_commit_sha to HEAD and deploy from main; API/worker keep their existing main release. The current GitHub main workflow does not deploy the separate settings resource automatically, so deploy it explicitly in Coolify. Access-token sessions verify channel, remaining lifetime, openid and LINE userinfo on every protected request; old ID-token sessions remain supported.
