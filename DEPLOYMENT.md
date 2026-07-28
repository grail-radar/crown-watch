# Deploying Crown Watch (free tier)

Free stack: **Vercel** (web) · **Render** (API, Docker) · **Neon** (Postgres) ·
**GitHub Actions** (RSS cron).

You run the account/login/deploy steps (I can't create accounts or log in for
you); every value you need is listed below. Push this repo to GitHub first.

---

## 1. Database — Neon (Postgres)
1. https://neon.tech → new project (pick a region near your users).
2. Copy the **direct** connection string (Connection Details → *Direct connection*):
   ```
   postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/DB?sslmode=require
   ```
   Keep it — this is your `DATABASE_URL`.

## 2. API — Render (Docker, free)
1. https://render.com → **New → Blueprint** → connect this repo (it reads `render.yaml`).
2. Set env vars when prompted:
   - `DATABASE_URL` = your Neon string
   - `WEB_ORIGIN` = leave blank for now (fill in after step 4)
3. Create. Render builds `apps/api/Dockerfile`, runs `prisma migrate deploy` on
   boot, and starts the API.
4. Copy the service URL, e.g. `https://crown-watch-api.onrender.com`.

> Free plan sleeps after ~15 min idle; the first request after sleep is slow (cold start). Expected.

## 3. Seed the RSS sources on Neon (one time)
Migrations create the tables but not the seed rows. From your machine, pointed at Neon:
```bash
# macOS/Linux
DATABASE_URL="<neon-url>" pnpm --filter @crown-watch/api exec prisma db seed
```
```powershell
# Windows PowerShell
$env:DATABASE_URL="<neon-url>"; pnpm --filter @crown-watch/api exec prisma db seed
```

## 4. Web — Vercel (free)
1. https://vercel.com → **Add New → Project** → import this repo.
2. **Root Directory = `apps/web`** (Vercel auto-detects Next.js + the pnpm workspace).
3. Deploy → copy the URL, e.g. `https://crown-watch.vercel.app`.
4. Back in Render → API service → Environment → set `WEB_ORIGIN` to that Vercel URL → save (redeploys).

## 5. RSS polling — GitHub Actions
The workflow `.github/workflows/rss-poll.yml` pokes the API every 20 min (free
hosts sleep, so the in-process cron isn't reliable).
1. GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**:
   - `API_BASE_URL` = your Render URL (no trailing slash)
2. Actions tab → enable workflows. Trigger once via **Run workflow** to test.

## 6. Telegram drop broadcast (optional)
Detected drops are posted to two public channels, one per language. Skip this
and ingestion still works — dispatch just logs that it was skipped.
1. Telegram → [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. Create the two channels (UA + EN), then add the bot to each as an **admin**
   with *Post messages* permission.
3. Render → API service → Environment:
   - `TELEGRAM_BOT_TOKEN` = the BotFather token
   - `TELEGRAM_CHANNEL_UK` = `@your_ua_channel`
   - `TELEGRAM_CHANNEL_EN` = `@your_en_channel`

> Posts are at-most-once per channel and are never retried after a failure —
> [ADR-0002](./docs/adr/0002-broadcasts-are-at-most-once.md). To force a
> re-broadcast, delete that drop's row from `drop_broadcasts` and poll again.

## 7. Verify
```bash
curl https://<render-url>/health                      # {"status":"ok","db":"up"}
curl -X POST https://<render-url>/ingestion/rss/poll  # first run inserts ~50
```
Check the data in Neon's SQL editor, or Prisma Studio pointed at Neon:
```bash
DATABASE_URL="<neon-url>" pnpm --filter @crown-watch/api exec prisma studio
```

---

## Notes
- **Migrations auto-apply** on every API deploy (`prisma migrate deploy` in the Docker `CMD`).
- **Port**: the API reads `$PORT` (Render/Fly inject it) and binds `0.0.0.0`.
- **Redis/BullMQ**: not used yet; when needed, add Upstash (free) and set `REDIS_URL`.
- **Later**: slim the image with a multi-stage prod prune, add CI, and move
  polling to BullMQ once traffic grows.
