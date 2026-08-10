import { Injectable, NotFoundException } from '@nestjs/common';
import { ModerationStatus } from '@prisma/client';
import { AlertDispatchService } from '../alerts/alert-dispatch.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Human moderation over candidate drops. Approving a drop sets it published,
 * which is what makes it visible on the public feed (CONTEXT.md §5) — and, from
 * that same moment, announced to the channels.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertDispatchService,
  ) {}

  /** Pending drops awaiting review (the moderation queue). */
  async queue(take = 50) {
    const safeTake = Math.min(Math.max(take, 1), 200);
    const [total, drops] = await this.prisma.$transaction([
      this.prisma.drop.count({
        where: { moderationStatus: ModerationStatus.pending },
      }),
      this.prisma.drop.findMany({
        where: { moderationStatus: ModerationStatus.pending },
        orderBy: { createdAt: 'asc' },
        take: safeTake,
        select: {
          id: true,
          title: true,
          type: true,
          priceLow: true,
          priceHigh: true,
          currency: true,
          eventDate: true,
          imageUrl: true,
          sourceUrl: true,
          confidenceScore: true,
          // Null for an extracted Drop, which is pending because that is where
          // extracted Drops start. Set only where something demoted a Drop that
          // would otherwise have published itself — today, a `sourceUrl` the
          // store would not serve (ADR-0007). Without it a reviewer cannot tell
          // the two apart, and the second kind needs the link checked before
          // approving rather than the prose.
          heldReason: true,
          createdAt: true,
          brand: { select: { name: true, slug: true } },
        },
      }),
    ]);
    return { total, count: drops.length, drops };
  }

  /**
   * Approve + publish a drop so it appears on the public feed, and announce it.
   *
   * A reviewer clicking approve has decided the drop is real and public, which
   * is exactly the moment it should reach people's phones. The announcement is
   * queued rather than awaited: publishing must not depend on Telegram being
   * reachable, and a reviewer must not wait on a third party. Re-approving is
   * harmless — a drop reaches a channel at most once ever (ADR-0002).
   */
  async approve(id: string) {
    await this.ensureExists(id);
    const drop = await this.prisma.drop.update({
      where: { id },
      data: {
        moderationStatus: ModerationStatus.approved,
        reviewedAt: new Date(),
        publishedAt: new Date(),
      },
      select: {
        id: true,
        title: true,
        moderationStatus: true,
        publishedAt: true,
      },
    });

    // Only after the row is committed: an alert for a drop that failed to
    // publish would point at a page nobody can see.
    this.alerts.enqueueBroadcast(drop.id);
    return drop;
  }

  /** Reject a drop (kept for the record, never published). */
  async reject(id: string) {
    await this.ensureExists(id);
    return this.prisma.drop.update({
      where: { id },
      data: {
        moderationStatus: ModerationStatus.rejected,
        reviewedAt: new Date(),
      },
      select: { id: true, title: true, moderationStatus: true },
    });
  }

  private async ensureExists(id: string): Promise<void> {
    const drop = await this.prisma.drop.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!drop) throw new NotFoundException(`Drop not found: ${id}`);
  }
}
