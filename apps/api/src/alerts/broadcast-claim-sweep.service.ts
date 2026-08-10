import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { configuredChannels } from './destinations';

/**
 * How many Drops a dry run names before it starts summarising.
 *
 * High enough that a real sweep lists **every** row rather than a sample: #48's
 * chat holds 30 claims, and "lists exactly what would be removed" is not
 * satisfied by five of them and a count. The cap only exists so that pointing
 * this at a chat with thousands of claims does not fill a terminal.
 */
const MAX_LISTED_DROPS = 200;

export interface ClaimSweepRequest {
  /**
   * Exactly which Channels to sweep, by the key held in
   * `drop_broadcasts.chat_id`. Never a pattern: a brand genuinely called
   * something is not impossible, and #48 is explicit that what goes must be
   * identified by evidence rather than by a name that looks like test data.
   */
  chatIds: string[];
  /** Actually delete. Omitted or false reports and changes nothing. */
  confirm?: boolean;
}

/** Row counts either side of the sweep, so overreach is visible not assumed. */
export interface ClaimSweepCounts {
  drops: number;
  brands: number;
  sources: number;
  broadcasts: number;
}

/**
 * One chat the sweep was asked about.
 *
 * Deliberately not called a Channel. A Channel is somewhere a Drop is announced
 * and claimed against (`CONTEXT.md` §9) — these are chats that are not one, and
 * calling them Channels is how the distinction this whole service rests on gets
 * lost.
 */
export interface ClaimSweepChatReport {
  chatId: string;
  claims: number;
  /** How many of those claims say a message actually went out. */
  sent: number;
  /** Distinct Drops involved. */
  drops: number;
  /** Every one of them, up to {@link MAX_LISTED_DROPS}. */
  listed: Array<{ id: string; title: string; brand: string }>;
}

export interface ClaimSweepReport {
  confirmed: boolean;
  /** The chats asked about — never Channels, by definition of the job. */
  chats: ClaimSweepChatReport[];
  /**
   * Every Channel we currently post to, reported so the guard's state is
   * visible. A silently empty list is the failure mode that would make this
   * whole service dangerous, so it is shown rather than merely applied.
   */
  liveChannels: string[];
  /** Requested chat ids that are live Channels, and were therefore not swept. */
  refused: Array<{ chatId: string; reason: string }>;
  /** Requested chat ids with no claims at all — most likely a typo. */
  unmatched: string[];
  deleted: number;
  counts: { before: ClaimSweepCounts; after: ClaimSweepCounts };
}

/**
 * Deletes `drop_broadcasts` rows claimed against a Channel that never existed.
 *
 * **This is the operation ADR-0002 exists to forbid.** A claim row is the only
 * record that a Drop reached a Channel, and removing one makes that Drop a
 * candidate again — which is why `BroadcastPurgeService` keeps every row even
 * when it deletes the post it refers to. Nothing here weakens that rule; it
 * carves out the one case where the rule protects nothing:
 *
 * On 2026-08-07 the tests ran against production and `@crownwatch_ua_v2` — a
 * chat that exists only in `alert-dispatch.service.spec.ts` — took 30 claims.
 * **No message was ever sent to it, because there is no such chat.** So there is
 * no "already told" fact to preserve, and nothing is lost by removing them.
 *
 * What they cost is smaller than #48 first claimed, and worth stating honestly:
 * every broadcast count includes them, and anyone reading this data has to
 * work out for themselves that a third "channel" is a spec artefact.
 * `purge:broadcasts` does **not** trip over them — it selects only claims whose
 * Drop is `rejected` and unpublished, and these point at live, published Drops,
 * so they were never in its working set. This is tidying, not a fix.
 *
 * The guard that makes this safe is one line of intent: a chat id we currently
 * post to is refused outright. Deleting a live Channel's claims would make its
 * Drops candidates again and tell followers a second time about releases they
 * have already seen — the exact harm ADR-0002 names. The list of live Channels
 * comes from `configuredChannels`, the same function the dispatcher resolves
 * its destinations with, because two answers to "where do we post" is how that
 * guard would quietly stop guarding.
 */
@Injectable()
export class BroadcastClaimSweepService {
  private readonly logger = new Logger(BroadcastClaimSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async sweep(request: ClaimSweepRequest): Promise<ClaimSweepReport> {
    const chatIds = [...new Set(request.chatIds.map((c) => c.trim()).filter(Boolean))];
    if (chatIds.length === 0) {
      // An empty list must never mean "everything". This script deletes the
      // rows that make at-most-once true; the blast radius of a default is the
      // whole table.
      throw new Error('Name at least one chat id to sweep.');
    }

    // Live Channels first. If the request names one, the run stops rather than
    // doing the safe part of it: an operator who mistyped one of two ids should
    // get an error, not a half-applied sweep to reason about afterwards.
    const channelList = configuredChannels(this.config);
    if (channelList.length === 0) {
      // **Fail closed.** Telegram configuration is optional and an unconfigured
      // bot is a supported boot state, so a shell with `DATABASE_URL` set and no
      // `TELEGRAM_*` would leave this guard silently empty — and
      // `--chat=@crownwatch_ua --confirm` would then delete several hundred
      // real claims without a word. The guard has to be present to be a guard.
      throw new Error(
        'No Channels are configured, so I cannot tell a dead chat id from a live ' +
          'one and will not delete anything. Set TELEGRAM_CHANNEL_UA / _EN (and ' +
          'TELEGRAM_GROUPS if you use partner groups) to the values the deployment ' +
          'actually posts with, then run this again.',
      );
    }
    const live = new Set(channelList.flatMap((c) => [c.key, c.chatId]));
    const refused = chatIds
      .filter((chatId) => live.has(chatId))
      .map((chatId) => ({
        chatId,
        reason:
          'This is a Channel we post to. Deleting its claims would offer every ' +
          'one of those Drops to it again (ADR-0002).',
      }));

    const chats: ClaimSweepChatReport[] = [];
    for (const chatId of chatIds) {
      chats.push(await this.describe(chatId));
    }
    const unmatched = chats.filter((c) => c.claims === 0).map((c) => c.chatId);

    const before = await this.counts();
    let deleted = 0;
    const confirmed = request.confirm === true && refused.length === 0;

    if (refused.length > 0) {
      for (const { chatId } of refused) {
        this.logger.error(`Refusing to sweep ${chatId}: it is a live Channel.`);
      }
    } else if (confirmed) {
      const result = await this.prisma.dropBroadcast.deleteMany({
        where: { chatId: { in: chatIds } },
      });
      deleted = result.count;
      this.logger.warn(
        `Deleted ${deleted} broadcast claim(s) against ${chatIds.join(', ')}.`,
      );
    }

    const after = confirmed ? await this.counts() : before;
    return {
      confirmed,
      chats,
      liveChannels: [...live].sort(),
      refused,
      unmatched,
      deleted,
      counts: { before, after },
    };
  }

  /** What one chat's claims are, and which Drops they belong to. */
  private async describe(chatId: string): Promise<ClaimSweepChatReport> {
    const claims = await this.prisma.dropBroadcast.findMany({
      where: { chatId },
      select: {
        status: true,
        drop: { select: { id: true, title: true, brand: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const drops = new Map<string, { id: string; title: string; brand: string }>();
    for (const claim of claims) {
      if (!claim.drop) continue;
      drops.set(claim.drop.id, {
        id: claim.drop.id,
        title: claim.drop.title,
        brand: claim.drop.brand.name,
      });
    }
    return {
      chatId,
      claims: claims.length,
      sent: claims.filter((c) => c.status === 'sent').length,
      drops: drops.size,
      listed: [...drops.values()].slice(0, MAX_LISTED_DROPS),
    };
  }

  /**
   * The tables a sweep must not touch, plus the one it does.
   *
   * Counted rather than trusted. #48 asks for before-and-after precisely
   * because "it only deleted what I asked for" is the kind of claim that is
   * cheap to make and expensive to be wrong about.
   *
   * **A smoke test, not a proof.** These do not share a transaction with the
   * delete, so a poll running at the same moment moves `drops` and `sources`
   * legitimately. A difference means "look", not "something broke".
   */
  private async counts(): Promise<ClaimSweepCounts> {
    const [drops, brands, sources, broadcasts] = await this.prisma.$transaction([
      this.prisma.drop.count(),
      this.prisma.brand.count(),
      this.prisma.source.count(),
      this.prisma.dropBroadcast.count(),
    ]);
    return { drops, brands, sources, broadcasts };
  }
}
