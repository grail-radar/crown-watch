import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AlertDispatchService } from './alert-dispatch.service';

/** Enough Drops to recognise what a chat's claims are, not a wall of them. */
const SAMPLE_SIZE = 5;

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

export interface ClaimSweepChannelReport {
  chatId: string;
  claims: number;
  /** How many of those claims say a message actually went out. */
  sent: number;
  /** Distinct Drops involved. */
  drops: number;
  /** A few of them, so an operator can see what they were. */
  sample: Array<{ id: string; title: string; brand: string }>;
}

export interface ClaimSweepReport {
  confirmed: boolean;
  channels: ClaimSweepChannelReport[];
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
 * no "already told" fact to preserve, and `purge:broadcasts` fails on those
 * rows with "chat not found" on every run, for ever (#48).
 *
 * The guard that makes this safe is one line of intent: a chat id that the
 * dispatcher currently posts to is refused outright. Deleting a live Channel's
 * claims would make its Drops candidates again and tell followers a second time
 * about releases they have already seen — the exact harm ADR-0002 names. The
 * list of live Channels is read from {@link AlertDispatchService.channels}
 * rather than rebuilt here, because two answers to "where do we post" is how
 * that guard would quietly stop guarding.
 */
@Injectable()
export class BroadcastClaimSweepService {
  private readonly logger = new Logger(BroadcastClaimSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertDispatchService,
  ) {}

  async sweep(request: ClaimSweepRequest): Promise<ClaimSweepReport> {
    const chatIds = [...new Set(request.chatIds.map((c) => c.trim()).filter(Boolean))];
    if (chatIds.length === 0) {
      // An empty list must never mean "everything". This script deletes the
      // rows that make at-most-once true; the blast radius of a default is the
      // whole table.
      throw new Error('Name at least one chat id to sweep.');
    }

    // Live Channels first, and before anything is counted: if the request names
    // one, the run stops here rather than doing the safe part of it. An
    // operator who mistyped one of two ids should get an error, not a
    // half-applied sweep they have to reason about afterwards.
    const live = new Set(this.alerts.channels().flatMap((c) => [c.key, c.chatId]));
    const refused = chatIds
      .filter((chatId) => live.has(chatId))
      .map((chatId) => ({
        chatId,
        reason:
          'This is a Channel we post to. Deleting its claims would offer every ' +
          'one of those Drops to it again (ADR-0002).',
      }));

    const channels: ClaimSweepChannelReport[] = [];
    for (const chatId of chatIds) {
      channels.push(await this.describe(chatId));
    }
    const unmatched = channels.filter((c) => c.claims === 0).map((c) => c.chatId);

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
    return { confirmed, channels, refused, unmatched, deleted, counts: { before, after } };
  }

  /** What one chat's claims are, and which Drops they belong to. */
  private async describe(chatId: string): Promise<ClaimSweepChannelReport> {
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
      sample: [...drops.values()].slice(0, SAMPLE_SIZE),
    };
  }

  /**
   * The tables a sweep must not touch, plus the one it does.
   *
   * Counted rather than trusted. #48 asks for before-and-after precisely
   * because "it only deleted what I asked for" is the kind of claim that is
   * cheap to make and expensive to be wrong about.
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
