import { Injectable, NotFoundException } from '@nestjs/common';
import { ModerationStatus, Prisma } from '@prisma/client';
import { purchaseLinkFor } from '../drops/purchase-link';
import { PrismaService } from '../prisma/prisma.service';

const PUBLISHED: Prisma.DropWhereInput = {
  moderationStatus: ModerationStatus.approved,
  publishedAt: { not: null },
};

const DROP_TYPES = new Set<string>([
  'kickstarter_launch',
  'waitlist_open',
  'restock',
  'pre_order',
]);

/** Fields the public feed exposes for a drop. */
const DROP_SELECT = {
  id: true,
  title: true,
  type: true,
  priceLow: true,
  priceHigh: true,
  currency: true,
  eventDate: true,
  promisedShipDate: true,
  imageUrl: true,
  sourceUrl: true,
  publishedAt: true,
  // `type` decides whether sourceUrl is a product page or an article; `name` is
  // shown as the credit. Neither is exposed — see flattenDrop.
  sourceEvent: {
    select: { source: { select: { name: true, type: true } } },
  },
  brand: { select: { website: true } },
} satisfies Prisma.DropSelect;

type DropRow = Prisma.DropGetPayload<{ select: typeof DROP_SELECT }>;

/**
 * Shape a drop for the public API.
 *
 * The purchase link is resolved here rather than by whoever renders it. The
 * website and the Telegram channels answer from the same rule, so they cannot
 * classify one drop differently — a purchase label over a magazine article
 * shipped once already, and it shipped because two callers each decided for
 * themselves. Provenance is deliberately dropped from the response: the website
 * has no business re-deriving this, and cannot if it never sees the inputs.
 */
function flattenDrop(row: DropRow) {
  const { sourceEvent, brand, ...drop } = row;
  return {
    ...drop,
    sourceName: sourceEvent?.source?.name ?? null,
    purchase: purchaseLinkFor({
      sourceType: sourceEvent?.source?.type,
      sourceUrl: drop.sourceUrl,
      brandWebsite: brand?.website,
    }),
  };
}

/**
 * The same, for the paths that present the brand alongside the drop. The brand
 * comes back as name and slug only: its website has already done its work
 * deciding the purchase link, and passing it on would tempt a caller to build
 * its own.
 */
function withBrand(
  row: DropRow & {
    brand: { name: string; slug: string; website: string | null };
  },
) {
  const { name, slug } = row.brand;
  return { ...flattenDrop(row), brand: { name, slug } };
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
        brand: { select: { name: true, slug: true, website: true } },
      },
    });
    if (!drop) throw new NotFoundException(`Drop not found: ${id}`);
    return withBrand(drop);
  }

  async listPublishedDrops(take = 50, skip = 0, type?: string) {
    const safeTake = Math.min(Math.max(take, 1), 200);
    const safeSkip = Math.max(skip, 0);
    const where: Prisma.DropWhereInput = {
      ...PUBLISHED,
      ...(type && DROP_TYPES.has(type)
        ? { type: type as Prisma.EnumDropTypeFilter['equals'] }
        : {}),
    };
    const [total, drops] = await this.prisma.$transaction([
      this.prisma.drop.count({ where }),
      this.prisma.drop.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        take: safeTake,
        skip: safeSkip,
        select: {
          ...DROP_SELECT,
          brand: { select: { name: true, slug: true, website: true } },
        },
      }),
    ]);
    return {
      total,
      count: drops.length,
      drops: drops.map(withBrand),
    };
  }
}
