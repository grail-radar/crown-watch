# Telegram destinations runbook

How to add somewhere new for drop alerts to go — in particular a **partner
community**: a group somebody else owns, which has agreed to carry the feed in
one of its forum topics.

For *why* a post is never repeated or retried, see
[ADR-0002](../adr/0002-broadcasts-are-at-most-once.md). This document is only
about wiring a destination up and proving it works.

---

## The two kinds of destination

| | Ours | A partner community |
|---|---|---|
| Configured by | `TELEGRAM_CHANNEL_UA` / `TELEGRAM_CHANNEL_EN` | `TELEGRAM_GROUPS` |
| Looks like | `@crownwatch_ua` | `uk:-1001234567890:42` |
| Bot needs | admin, *Post messages* | permission to send in that topic |
| A bad post costs | our own followers | somebody else's goodwill |

`TELEGRAM_GROUPS` is comma-separated `locale:chatId[:topicId]`. The locale picks
the language the alert is written in — a Ukrainian community gets `uk`, and only
that one message, not one per language.

A malformed entry **stops the API at boot**. This is deliberate and differs from
every other Telegram setting: an unset channel is a supported state, but a
mistyped group id is a community that silently receives nothing, with no symptom
visible from our side at all.

---

## Before touching any configuration

A partner group is a relationship, not a config value. Agree with its admins:

- **Which topic**, exactly. Posting to the group without naming a topic puts the
  alert in *General*, which is the wrong room and cannot be unsent.
- **What the message looks like.** It is the standard drop alert — brand, model,
  release or restock, price when the store exposes one, a link to the product
  page and a link to the brand's page on Crown Watch. Notably it carries **no
  invitation to our own channel**: a community that agreed to carry news did not
  agree to be a funnel.
- **Roughly how often.** One message per drop per topic. Today that is a handful
  a week, not a stream.

---

## Adding a group

1. **Get the bot into the group.** A group admin adds it. Sending in a topic is
   enough — admin rights are only needed if the group restricts who may post.
2. **Find the ids.** In the topic that will carry the feed, post
   `/start@<yourbot>` — a bot in a group is told about nothing else by default —
   then read both ids off:

   ```bash
   pnpm --filter @crown-watch/api telegram:destinations -- --discover
   ```

   Each line is `chatId:topicId  <chat type> "<title>" → <topic>`, which is the
   `TELEGRAM_GROUPS` entry minus the language.
3. **Set the variable**, locally in `apps/api/.env` and on Render:

   ```
   TELEGRAM_GROUPS="uk:-1001234567890:42"
   ```

4. **Verify.** Without arguments the script reports every configured destination,
   the bot's standing in it, and whether the topic setting matches the chat:

   ```bash
   pnpm --filter @crown-watch/api telegram:destinations
   ```

   It warns when a topic is configured for a chat that has none, and — the
   likelier mistake — when a chat *has* topics and none is configured.

5. **Prove the topic id.** The Bot API cannot list a forum's topics, so an
   accepted post is the only proof. This posts one message per destination and
   deletes it again:

   ```bash
   pnpm --filter @crown-watch/api telegram:destinations -- --send-test
   ```

   It is sent silently and removed within a second, but it does briefly reach a
   real group — run it once, deliberately.

---

## What happens the first time it is live

The group is a channel that has never seen any drop, so **every published drop
is a backfill candidate for it**. Left alone, the next backfill run would post
the entire backlog into somebody else's community.

Read the dry run first — it names the exact destination of every message:

```bash
pnpm --filter @crown-watch/api backfill:telegram -- --limit=50
```

Then either post a deliberate few, oldest first:

```bash
pnpm --filter @crown-watch/api backfill:telegram -- --confirm --limit=3
```

…or skip the backlog entirely, so the group starts from the next real drop, by
claiming the old ones without sending — run against the production database:

```sql
INSERT INTO drop_broadcasts (id, drop_id, chat_id, locale, status, created_at)
SELECT gen_random_uuid()::text, d.id, '-1001234567890:42', 'uk', 'sent', now()
FROM drops d
WHERE d.published_at IS NOT NULL
  AND d.moderation_status = 'approved'
ON CONFLICT (drop_id, chat_id) DO NOTHING;
```

`chat_id` holds the **channel key**, which for a topic is `chat:topic` — the
same string as in `TELEGRAM_GROUPS`, minus the language. That is what keeps two
topics of one supergroup from claiming each other's posts.

---

## Deleting posts that should never have gone out

Retracting a drop takes it off the site. It does **not** take it out of a
channel — a channel is somebody else's copy of what we said. This closes that
gap, for the one window Telegram allows.

> ### ⏱ 48 hours, and not a minute more
>
> Telegram refuses to delete a message older than 48 hours. After that the post
> is in the channel permanently, whatever we do. If you are reading this because
> something was announced by mistake, **check the clock before anything else.**

It works because a retraction keeps the `drop_broadcasts` rows, and each row
carries Telegram's own `message_id`. Deleting the drops instead would have taken
those ids with them, leaving no way to find the posts except by hand.

```bash
pnpm --filter @crown-watch/api purge:broadcasts
```

Dry run by default: reports how many posts belong to retracted drops, per
channel, and touches nothing. Then:

```bash
pnpm --filter @crown-watch/api purge:broadcasts -- --confirm
```

Narrow it with `--since=<ISO>` / `--until=<ISO>` when only one incident's posts
should go.

**What it will and will not do**

- Only posts whose drop has been **retracted** — a live drop's post is never touched.
- Deletes in batches of 100, which is Telegram's own cap on `deleteMessages`.
- **Never removes the `drop_broadcasts` rows.** They are what makes "at most
  once, ever" true ([ADR-0002](../adr/0002-broadcasts-are-at-most-once.md)), and
  keeping them is also what makes this safe to run twice.
- One channel refusing does not stop the others; each is reported separately.

**It does not unsend anything.** Every follower who was going to be notified has
been. This only stops the post sitting in the channel's history — which is worth
doing, and is not the same as undoing it.

---

## Sweeping claims against a channel that never existed

The one case where deleting a `drop_broadcasts` row is correct, and the reason
the section above is so insistent that it never does.

A claim row means "this drop reached this channel". A claim against a chat that
does not exist means nothing of the kind: no follower saw anything, so there is
no repetition to prevent.

Written for #48: on 2026-08-07 the tests ran against production, and
`@crownwatch_ua_v2` — a handle that exists only in
`alert-dispatch.service.spec.ts` — took 30 claims.

**This is tidying, not a fix.** The rows are inert: nothing reaches a reader,
and `purge:broadcasts` never touches them either, because it selects only claims
whose drop is `rejected` and unpublished and these point at live, published
drops. What they cost is that every broadcast count includes them, and the next
person reading this data has to work out for themselves that a third "channel"
is a string from a spec file. Worth doing; not urgent.

```bash
pnpm --filter @crown-watch/api sweep:claims -- --chat=@crownwatch_ua_v2
```

Dry run by default. It prints the claim count, how many say a message went out,
and the drops involved, and changes nothing. **Read that list.** Then:

```bash
pnpm --filter @crown-watch/api sweep:claims -- --chat=@crownwatch_ua_v2 --confirm
```

Afterwards it prints row counts for drops, brands, sources and broadcasts,
before and after. Only the last should have moved; it says so loudly if
anything else did.

**What it refuses**

- **Running at all when no channel is configured.** Telegram settings are
  optional and this script is pointed at production by `DATABASE_URL` alone, so
  a shell without `TELEGRAM_CHANNEL_UA` / `_EN` would leave the guard below with
  nothing to compare against — and it would then happily delete a live channel's
  claims. It fails closed instead, and prints what it believes is live so their
  absence is visible rather than silent. **Set the same values the deployment
  posts with.**
- **Any chat id the bot currently posts to.** It reads that list from the
  dispatcher itself, so the guard cannot drift from where alerts actually go.
  Deleting a live channel's claims would offer every one of those drops to it
  again, and followers would be told a second time about releases they have
  already seen ([ADR-0002](../adr/0002-broadcasts-are-at-most-once.md)).
- **A run naming both a ghost and a live channel** — the whole run stops rather
  than doing the safe half, so a mistyped id is an error and not a partly
  applied sweep.
- **An empty list.** There is deliberately no "sweep everything".

A chat id matching no claims at all is reported as unmatched rather than passing
silently, because a typo otherwise looks exactly like a finished job.

**Before running it against production**, re-check what is actually there — the
ticket's original figures were wrong, and the audit on
[#48](https://github.com/grail-radar/crown-watch/issues/48) is the corrected one.

---

## Removing a group

Delete its entry from `TELEGRAM_GROUPS` and redeploy. Nothing else is needed:
the claim rows stay, so re-adding the same topic later resumes from where it
stopped rather than replaying the backlog.
