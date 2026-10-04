# ParkMap LIFF

Student-facing app opened from the LINE Official Account rich menu. It lists sites and shows a navigable 3D lot model with live regions and motorcycle proxies. It renders what `apps/vision-api` decides and never computes availability itself. See [ADR 0002](../../docs/adr/0002-live-state-pipeline-and-liff-app.md).

## Run

```sh
cp .env.example .env.local
pnpm dev   # http://localhost:3001
```

Start the API with seeded development data first (see the root README). Without `NEXT_PUBLIC_LIFF_ID` the app runs as a plain web page.

## LINE environments

The app is a LIFF app on a LINE Login channel ([ADR 0006](../../docs/adr/0006-liff-app-on-a-line-login-channel.md)). One team member creates the provider and the LINE Official Account, and every team member is an Admin of the provider, the Official Account, and all its channels, so no single account blocks the team. A LIFF app has one endpoint URL, so each environment has its own LIFF app and LIFF ID. Two LINE Login channels under the same provider keep them apart, because publishing is per channel:

- **Production:** channel `ParkMap`, one LIFF app on Coolify. The API stays on Coolify's internal network; only the LIFF app has a public HTTPS domain. The rich menu opens this LIFF app. The channel is published when people outside the team need to open it.
- **Development:** channel `ParkMap Dev`, which stays in Developing status so only its admins and testers can open its LIFF apps. Each developer has one LIFF app there pointing at their local `pnpm dev` through their own named Cloudflare Tunnel on the team domain (`dev-<name>.<team domain>`), so the endpoint URL is set once; put that LIFF ID in `.env.local`. Quick tunnels are not used, because their URL changes on every run.

The production rich menu is created by a script in `apps/liff` that uses `@line/bot-sdk` and links to `https://liff.line.me/{production LIFF ID}`, so the menu definition and image are versioned in Git. It needs Messaging API enabled on the LINE Official Account and reads the channel access token from the environment only. `@line/bot-sdk` is used only by this script, never by the Next app at runtime. The token is not stored anywhere: whoever runs the script, as an Admin, copies it from the LINE Developers Console into `LINE_CHANNEL_ACCESS_TOKEN` for that shell only, never into a `.env` file, Coolify, chat, or logs, and reissues it in the console if it may have leaked. Menu buttons use URI actions only; postback actions wait for a webhook.

The menu is a large rich menu with five buttons, each opening a path of the same production LIFF app: the largest for current available space (the site list), then where I parked, nearby parking, help, and settings. Only the available-space screen exists at M1; the other four open a "coming soon" page until their feature is grilled and built, and the script is rerun whenever a button's target changes. A future reply bot would be its own service on Coolify with the token in that service's environment, and would reopen the no-identity rule of ADR 0002. Development LIFF apps have no rich menu; developers open `https://liff.line.me/{their LIFF ID}` directly. Never tunnel the API. A tunnel URL is public in a browser even though the LIFF app is not.

## Layout

- `src/app/api/sites/[siteId]/parking-state/route.ts`: server-side proxy to FastAPI; the browser polls it every 4 s.
- `src/lib/api/`: `openapi-fetch` client and types generated from `apps/vision-api/openapi.json`. Do not edit `schema.gen.ts`; run `pnpm api:generate`.
- `src/lib/parking/`: presentation only (labels, colours, client-side staleness downgrade). A region is never shown green unless the API returned it as `AVAILABLE` for a `LIVE` area.
- `src/components/lot-scene.tsx`: react-three-fiber scene. Metric lot coordinates `(x, y)` map to world `(x, 0, -y)`.

## UI components

shadcn is configured (`components.json`, style `base-luma`). The primary colour is the logo pink, darkened slightly so white text passes WCAG AA; it is set in `src/app/globals.css`. Keep it distinct from the parking status colours, which only `src/lib/parking/presentation.ts` defines. Add components with `pnpm dlx shadcn@4.21.0 add <name>`. Magic UI, Animate UI, and ReUI are shadcn registries: `pnpm dlx shadcn@4.21.0 add @magicui/<name>`, `@animate-ui/<name>`, `@reui/<name>`. Add only what a screen uses.

Animations use `motion`. `Providers` wraps the app in `MotionConfig reducedMotion="user"`, so the OS reduce-motion setting turns off transform animations, and in `LazyMotion` with `domAnimation`, so app code uses `m.*` from `motion/react` to keep the bundle small on low-end phones. Never animate parking status colours or counts in a way that suggests a state the API did not return.

The rich-menu placeholder pages are `/parked`, `/nearby`, `/help`, and `/settings` (`src/components/coming-soon.tsx`).

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
