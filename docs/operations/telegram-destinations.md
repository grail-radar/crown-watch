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

## Removing a group

Delete its entry from `TELEGRAM_GROUPS` and redeploy. Nothing else is needed:
the claim rows stay, so re-adding the same topic later resumes from where it
stopped rather than replaying the backlog.
