import { Injectable, NotFoundException } from '@nestjs/common';
import { ModerationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Human moderation over candidate drops. Approving a drop sets it published,
 * which is what makes it visible on the public feed (CONTEXT.md §5).
 */
@Injectable()
export class ModerationService {
  constructor(private readonly prisma: PrismaService) {}

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
          confidenceScore: true,
          createdAt: true,
          brand: { select: { name: true, slug: true } },
        },
      }),
    ]);
    return { total, count: drops.length, drops };
  }

  /** Approve + publish a drop so it appears on the public feed. */
  async approve(id: string) {
    await this.ensureExists(id);
    return this.prisma.drop.update({
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
