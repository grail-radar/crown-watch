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
# Apply pending migrations, then boot. Render/Fly inject $PORT at runtime.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
