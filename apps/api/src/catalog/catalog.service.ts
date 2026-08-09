import { Injectable, NotFoundException } from '@nestjs/common';
import { ModerationStatus, Prisma, WatchKind } from '@prisma/client';
import { ABOUT_A_WATCH } from '../drops/about-a-watch';
import { purchaseLinkFor } from '../drops/purchase-link';
import { PrismaService } from '../prisma/prisma.service';

/**
 * What the public is allowed to see: approved, published, and about a watch.
 *
 * The accessory clause is a read filter rather than a cleanup — the Drops the
 * watcher announced before #38 are real history and stay in the database
 * (ADR-0006). It is shared with the digest and the dispatcher, because three
 * places each deciding what "public" means is how a strap ends up in a Channel.
 */
const PUBLISHED: Prisma.DropWhereInput = {
  moderationStatus: ModerationStatus.approved,
  publishedAt: { not: null },
  ...ABOUT_A_WATCH,
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
 * The most accessories a brand page will carry. A cap rather than pagination:
 * this is context beneath the Drops, and nobody is paging through straps.
 */
const MAX_ACCESSORIES = 60;

/** What a brand page needs about one accessory. */
const ACCESSORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  variants: {
    // Cheapest first, so the "from" price is the first priced one. Postgres
    // sorts NULL last by default, so an unpriced variant cannot lead.
    orderBy: [{ price: 'asc' }, { productUrl: 'asc' }],
    select: {
      price: true,
      currency: true,
      imageUrl: true,
      available: true,
    },
  },
} satisfies Prisma.WatchSelect;

type AccessoryRow = Prisma.WatchGetPayload<{ select: typeof ACCESSORY_SELECT }>;

/**
 * A summary rather than the whole thing: the accessory's own page already
 * carries every way to buy it, so the brand page needs the cheapest price, a
 * photo, and whether it can be had at all.
 *
 * Variants arrive cheapest-first, so `price` is the "from" figure. The photo is
 * borrowed from whichever variant has one, exactly as a Watch borrows its own —
 * a store that photographs some references and not others still shows something.
 */
function summariseAccessory(row: AccessoryRow) {
  const priced = row.variants.find((v) => v.price !== null);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    priceLow: priced?.price ?? null,
    currency: priced?.currency ?? null,
    imageUrl: row.variants.find((v) => v.imageUrl)?.imageUrl ?? null,
    variantCount: row.variants.length,
    available: row.variants.some((v) => v.available),
  };
}

/**
 * In stock first, then alphabetical.
 *
 * A brand can sell forty straps and have half of them gone, and a list that
 * leads with what is unavailable reads as a dead catalogue. The alphabetical
 * half comes from the database's own `orderBy` surviving this pass, which it
 * does because `Array#sort` is specified as stable — worth saying out loud,
 * since a comparator returning 0 is otherwise easy to read as "unordered".
 */
function buyableFirst(
  a: { available: boolean },
  b: { available: boolean },
): number {
  if (a.available === b.available) return 0;
  return a.available ? -1 : 1;
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
          // Shown on the directory card, so a brand with no drops yet still
          // says something about itself.
          foundedYearEst: true,
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
        // The straps, bracelets and boxes this brand sells. They raise no Drop
        // and interrupt nobody, but the data has been collected all along and
        // this is where a reader meets it (ADR-0006).
        watches: {
          where: { kind: WatchKind.accessory },
          orderBy: { name: 'asc' },
          // Capped like every other read here. YEMA alone lists over a hundred
          // straps and cases, and a brand page is not a shop.
          take: MAX_ACCESSORIES,
          select: ACCESSORY_SELECT,
        },
      },
    });
    if (!brand) throw new NotFoundException(`Brand not found: ${slug}`);
    const { watches, ...rest } = brand;
    return {
      ...rest,
      drops: brand.drops.map(flattenDrop),
      accessories: watches.map(summariseAccessory).sort(buyableFirst),
    };
  }

  /**
   * One Watch, by the brand that makes it and its own slug.
   *
   * Variants are ordered cheapest first, because the first thing a reader wants
   * from a list of ways to buy the same watch is what the cheapest one costs.
   * A Watch has no image column of its own — it borrows whichever of its
   * variants has one, so a store that photographs only some references still
   * shows a picture.
   */
  async getWatch(brandSlug: string, watchSlug: string) {
    const watch = await this.prisma.watch.findFirst({
      where: { slug: watchSlug, brand: { slug: brandSlug } },
      select: {
        id: true,
        name: true,
        slug: true,
        firstSeenAt: true,
        brand: { select: { name: true, slug: true, website: true } },
        variants: {
          orderBy: [{ price: 'asc' }, { productUrl: 'asc' }],
          select: {
            id: true,
            productUrl: true,
            reference: true,
            price: true,
            currency: true,
            imageUrl: true,
            available: true,
          },
        },
      },
    });
    if (!watch) {
      throw new NotFoundException(`Watch not found: ${brandSlug}/${watchSlug}`);
    }
    return {
      ...watch,
      imageUrl: watch.variants.find((v) => v.imageUrl)?.imageUrl ?? null,
    };
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
