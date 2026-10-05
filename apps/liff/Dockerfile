# Production image of the LIFF app (Next standalone output). Build context: repository root.
FROM node:22.18.0-trixie-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @parkmap/liff
# Public LIFF ID, inlined into the client bundle at build time.
ARG NEXT_PUBLIC_LIFF_ID
ENV NEXT_PUBLIC_LIFF_ID=$NEXT_PUBLIC_LIFF_ID \
  NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @parkmap/liff build

FROM node:22.18.0-trixie-slim
WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  PORT=3001
COPY --from=build --chown=node:node /repo/apps/liff/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/liff/.next/static ./apps/liff/.next/static
USER node
EXPOSE 3001
# /help is static, so the check does not depend on the API.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/help').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/liff/server.js"]
