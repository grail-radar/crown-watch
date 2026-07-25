import { Injectable, NotFoundException } from '@nestjs/common';
import { ModerationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PUBLISHED: Prisma.DropWhereInput = {
  moderationStatus: ModerationStatus.approved,
  publishedAt: { not: null },
};

/** Fields the public feed exposes for a drop. */
const DROP_SELECT = {
  id: true,
  title: true,
  type: true,
  priceLow: true,
  priceHigh: true,
  currency: true,
  eventDate: true,
  imageUrl: true,
  sourceUrl: true,
  publishedAt: true,
  sourceEvent: { select: { source: { select: { name: true } } } },
} satisfies Prisma.DropSelect;

type DropRow = Prisma.DropGetPayload<{ select: typeof DROP_SELECT }>;

function flattenDrop(row: DropRow) {
  const { sourceEvent, ...drop } = row;
  return { ...drop, sourceName: sourceEvent?.source?.name ?? null };
}

/**
 * Public, read-only catalog for the website: the brand directory and the
 * published-drops feed. Only moderation-approved, published drops are ever
 * exposed here (CONTEXT.md §5 — nothing reaches the public feed unmoderated).
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listBrands(take = 60, skip = 0) {
    const safeTake = Math.min(Math.max(take, 1), 200);
    const [total, brands] = await this.prisma.$transaction([
      this.prisma.brand.count(),
      this.prisma.brand.findMany({
        orderBy: { createdAt: 'desc' },
        take: safeTake,
        skip: Math.max(skip, 0),
        select: {
          id: true,
          name: true,
          slug: true,
          country: true,
          website: true,
          status: true,
          createdAt: true,
          // Published drops only — pending/rejected must not leak into the UI.
          _count: { select: { drops: { where: PUBLISHED } } },
        },
      }),
    ]);
    return { total, count: brands.length, brands };
  }

  async getBrandBySlug(slug: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        website: true,
        instagramHandle: true,
        country: true,
        foundedYearEst: true,
        status: true,
        createdAt: true,
        drops: {
          where: PUBLISHED,
          orderBy: { publishedAt: 'desc' },
          select: DROP_SELECT,
        },
      },
    });
    if (!brand) throw new NotFoundException(`Brand not found: ${slug}`);
    return { ...brand, drops: brand.drops.map(flattenDrop) };
  }

  /** One published drop by id (404 for pending/rejected/unknown). */
  async getPublishedDrop(id: string) {
    const drop = await this.prisma.drop.findFirst({
      where: { id, ...PUBLISHED },
      select: {
        ...DROP_SELECT,
        brand: { select: { name: true, slug: true } },
      },
    });
    if (!drop) throw new NotFoundException(`Drop not found: ${id}`);
    const { brand, ...rest } = drop;
    return { ...flattenDrop(rest), brand };
  }

  async listPublishedDrops(take = 50) {
    const safeTake = Math.min(Math.max(take, 1), 200);
    const drops = await this.prisma.drop.findMany({
      where: PUBLISHED,
      orderBy: { publishedAt: 'desc' },
      take: safeTake,
      select: {
        ...DROP_SELECT,
        brand: { select: { name: true, slug: true } },
      },
    });
    return {
      count: drops.length,
      drops: drops.map((row) => {
        const { brand, ...rest } = row;
        return { ...flattenDrop(rest), brand };
      }),
    };
  }
}
