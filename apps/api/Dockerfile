# syntax=docker/dockerfile:1
# Crown Watch API image. Build context is the REPO ROOT (monorepo):
#   docker build -f apps/api/Dockerfile -t crown-watch-api .
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable \
  && apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# ---- Build: install workspace deps, generate Prisma client, compile ----
FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @crown-watch/api...
COPY apps/api ./apps/api
RUN pnpm --filter @crown-watch/api exec prisma generate \
  && pnpm --filter @crown-watch/api build

# ---- Runner ----
FROM base AS runner
ENV NODE_ENV=production
# Copy the installed workspace (incl. generated Prisma client) and build output.
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 3333
# Apply pending migrations (retrying — free-tier DBs can be slow to wake or
# briefly hold locks), then boot. Render/Fly inject $PORT at runtime.
# NOTE: migrations need a DIRECT database connection; a pooled (PgBouncer)
# DATABASE_URL breaks Prisma's advisory locking (P1002).
CMD ["sh", "-c", "n=0; until pnpm exec prisma migrate deploy; do n=$((n+1)); if [ $n -ge 3 ]; then echo 'migrations failed after 3 attempts' >&2; exit 1; fi; echo 'migrate failed - retrying in 10s'; sleep 10; done; exec node dist/main.js"]
