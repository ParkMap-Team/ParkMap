# ParkMap LIFF

Student-facing app opened from the LINE Official Account rich menu. It lists sites and shows a navigable 3D lot model with live regions and motorcycle proxies. It renders what `apps/vision-api` decides and never computes availability itself. See [ADR 0002](../../docs/adr/0002-live-state-pipeline-and-liff-app.md).

## Run

```sh
cp .env.example .env.local
pnpm dev   # http://localhost:3001
```

Start the API with seeded development data first (see the root README). Without `NEXT_PUBLIC_LIFF_ID` the app runs as a plain web page.

## Layout

- `src/app/api/sites/[siteId]/parking-state/route.ts`: server-side proxy to FastAPI; the browser polls it every 4 s.
- `src/lib/api/`: `openapi-fetch` client and types generated from `apps/vision-api/openapi.json`. Do not edit `schema.gen.ts`; run `pnpm api:generate`.
- `src/lib/parking/`: presentation only (labels, colours, client-side staleness downgrade). A region is never shown green unless the API returned it as `AVAILABLE` for a `LIVE` area.
- `src/components/lot-scene.tsx`: react-three-fiber scene. Metric lot coordinates `(x, y)` map to world `(x, 0, -y)`.

## UI components

shadcn is configured (`components.json`, style `base-nova`). Add components with `pnpm dlx shadcn@4.21.0 add <name>`. Magic UI, Animate UI, and ReUI are shadcn registries: `pnpm dlx shadcn@4.21.0 add @magicui/<name>`, `@animate-ui/<name>`, `@reui/<name>`. Add only what a screen uses; animations come from `motion`.

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
