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
- **Development:** channel `ParkMap Dev`, which stays in Developing status so only its admins and testers can open its LIFF apps. Each developer has one LIFF app there pointing at their local `pnpm dev` through their own named Cloudflare Tunnel on `parkmap.dev` (`dev-<name>.parkmap.dev`), so the endpoint URL is set once; put that LIFF ID in `.env.local`. Quick tunnels are not used, because their URL changes on every run.

The production rich menu is created by a script in `apps/liff` that uses `@line/bot-sdk` and links to `https://liff.line.me/{production LIFF ID}`, so the menu definition and image are versioned in Git. It needs Messaging API enabled on the LINE Official Account and reads the channel access token from the environment only. `@line/bot-sdk` is used only by this script, never by the Next app at runtime. The token is not stored anywhere: whoever runs the script, as an Admin, copies it from the LINE Developers Console into `LINE_CHANNEL_ACCESS_TOKEN` for that shell only, never into a `.env` file, Coolify, chat, or logs, and reissues it in the console if it may have leaked. Menu buttons use URI actions only; postback actions wait for a webhook.

The menu is a large rich menu with five buttons, each opening a path of the same production LIFF app: the largest for current available space (the site list), then where I parked, nearby parking, help, and settings. Only the available-space screen exists at M1; the other four open a "coming soon" page until their feature is grilled and built, and the script is rerun whenever a button's target changes. A future reply bot would be its own service on Coolify with the token in that service's environment, and would reopen the no-identity rule of ADR 0002. Development LIFF apps have no rich menu; developers open `https://liff.line.me/{their LIFF ID}` directly. Never tunnel the API. A tunnel URL is public in a browser even though the LIFF app is not.

### Development tunnel

Once per developer, with `cloudflared` installed and `parkmap.dev` on Cloudflare:

```sh
cloudflared tunnel login
cloudflared tunnel create parkmap-dev-<name>
cloudflared tunnel route dns parkmap-dev-<name> dev-<name>.parkmap.dev
```

In the `ParkMap Dev` channel, add a LIFF app with endpoint URL `https://dev-<name>.parkmap.dev`, size Full, and the `openid` scope only. The console requires one scope, and `openid` grants the least: an ID token that the app never requests, because it reads no LINE identity. Turn off the add-friend option, Scan QR, and module mode. In `.env.local`, set `NEXT_PUBLIC_LIFF_ID` to its LIFF ID and `DEV_TUNNEL_HOST=dev-<name>.parkmap.dev`, which `next.config.ts` adds to `allowedDevOrigins` so the dev server accepts requests through the tunnel. Restart the dev server after changing it. Then, each session:

```sh
pnpm dev
cloudflared tunnel run --url http://localhost:3001 parkmap-dev-<name>
```

Open `https://liff.line.me/<your LIFF ID>` in LINE. Stop the tunnel when you do not need LINE, so the dev server is not public.

A developer may instead keep the tunnel running all the time, for example as a macOS LaunchAgent that runs the same `cloudflared tunnel run` command, and use plain `pnpm dev`. That is that developer's accepted risk: whenever anything listens on port 3001, anyone who knows the hostname can reach it, including the dev bundles and source maps, the error overlay with local paths, and the route handlers that call the local API.

### Rich menu

`scripts/rich-menu/` holds the production menu: `menu.ts` (the five buttons and their tap areas) and `rich-menu.jpg` (the image, at most 1 MB). The image was generated whole with Codex at 1536x1024, with the mascot, Thai labels, and the logo strip, so `menu.ts` uses that size and its tap areas meet in the middle of the gutters measured on the image; the logo strip is not a button. The production LIFF app has the same settings as a development one, with the site root as its endpoint URL, so `https://liff.line.me/{ID}/parked` opens `/parked`. To create or update the menu, as an Admin of the production channel:

```sh
read -rs LINE_CHANNEL_ACCESS_TOKEN && export LINE_CHANNEL_ACCESS_TOKEN   # paste; not echoed or kept in history
PRODUCTION_LIFF_ID=<production LIFF ID> pnpm rich-menu
unset LINE_CHANNEL_ACCESS_TOKEN
```

The script validates the menu with LINE, creates it, uploads the image, makes it the default, and then deletes every older menu created through the API, so running it again leaves exactly one. If the upload or default step fails, it deletes the new menu and the old default stays. It exits non-zero on any failure and never prints the token. When a button changes, generate a new image, check every Thai character and that it has no green or yellow (the parking status colours), measure its tiles and update the tap areas in `menu.ts`, save it as JPEG (the tests check its size and dimensions), and rerun the script.

## Layout

- `src/app/api/sites/[siteId]/parking-state/route.ts`: server-side proxy to FastAPI; the browser polls it every 4 s.
- `src/lib/api/`: `openapi-fetch` client and types generated from `apps/vision-api/openapi.json`. Do not edit `schema.gen.ts`; run `pnpm api:generate`.
- `src/lib/parking/`: presentation only (labels, colours, client-side staleness downgrade). A region is never shown green unless the API returned it as `AVAILABLE` for a `LIVE` area.
- `src/components/lot-scene.tsx`: react-three-fiber scene. Metric lot coordinates `(x, y)` map to world `(x, 0, -y)`.

## UI components

shadcn is configured (`components.json`, style `base-luma`). The primary colour is the logo pink, darkened slightly so white text passes WCAG AA; it is set in `src/app/globals.css`. Keep it distinct from the parking status colours, which only `src/lib/parking/presentation.ts` defines. Add components with `pnpm dlx shadcn@4.21.0 add <name>`. Magic UI, Animate UI, and ReUI are shadcn registries: `pnpm dlx shadcn@4.21.0 add @magicui/<name>`, `@animate-ui/<name>`, `@reui/<name>`. Add only what a screen uses.

Animations use `motion`. `Providers` wraps the app in `MotionConfig reducedMotion="user"`, so the OS reduce-motion setting turns off transform animations, and in `LazyMotion` with `domAnimation`, so app code uses `m.*` from `motion/react` to keep the bundle small on low-end phones. Never animate parking status colours or counts in a way that suggests a state the API did not return.

The mascot is the scooter character from the logo, in `src/assets/mascot/` (WebP with transparency): `happy` for placeholders, `confused` for errors and missing pages, and for loading a riding scene built from `riding-body` (the side view with its wheels cut out) and `wheel`, which spins behind each wheel arch while a dashed road scrolls underneath. The loading loop uses CSS animations so it starts before hydration and stays smooth while the page loads; wheel positions in `src/components/mascot.tsx` are measured on the 1024px source art of `riding-body` in `assets-source/mascot/`, which also holds the 512px `wheel`. It is decoration next to text, never on the live map and never a stand-in for parking status, so its images use no status colours.

The rich-menu placeholder pages are `/parked`, `/nearby`, `/help`, and `/settings` (`src/components/coming-soon.tsx`).

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
