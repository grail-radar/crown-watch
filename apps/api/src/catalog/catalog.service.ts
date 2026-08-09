import { Injectable, NotFoundException } from '@nestjs/common';
import { BrandStatus, ModerationStatus, Prisma, WatchKind } from '@prisma/client';
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
  // So a card can link straight to the Watch. Without it every click would
  // take the redirect hop the Drop URL now performs, which works but asks a
  // search engine to crawl a 308 to reach a page we linked from anyway.
  watch: { select: { slug: true, brand: { select: { slug: true } } } },
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
  const { sourceEvent, brand, watch, ...drop } = row;
  return {
    ...drop,
    // Flattened to the two slugs a link needs. The nested shape would tempt a
    // caller into re-deriving the URL differently from everywhere else.
    watch: watch ? { brandSlug: watch.brand.slug, watchSlug: watch.slug } : null,
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
 * One row per Watch, keeping the most recent event about it.
 *
 * A store listing one model as three products announced it three times before
 * grouping existed, and the backfill gave all three the same `watch_id` — so
 * YEMA's page lists "Superman Bronze CMM.10" three times for what was one
 * release. ADR-0003 already says one release is one Drop however many
 * references sit beneath it; this is that rule applied on the way out, to
 * history that was written before it existed.
 *
 * Rows must arrive newest-first, which is what makes the survivor the latest.
 * A Drop belonging to no Watch is never collapsed: those come from a
 * publication's prose, they are not duplicates of each other, and folding them
 * together would delete news rather than de-duplicate it.
 *
 * Keyed on the Watch's slug rather than its id because that is what the select
 * carries, and it is unique per brand — which is all this needs, running as it
 * does over one brand's Drops.
 */
function oneDropPerWatch(rows: DropRow[]): DropRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (!row.watch) return true;
    if (seen.has(row.watch.slug)) return false;
    seen.add(row.watch.slug);
    return true;
  });
}

/**
 * The most accessories a brand page will carry. A cap rather than pagination:
 * this is context beneath the Drops, and nobody is paging through straps.
 */
const MAX_ACCESSORIES = 60;

/**
 * The most Watches a brand page will render. Higher than the accessory cap
 * because this section is the point of the page rather than context beneath it,
 * and still a cap rather than pagination: the largest catalogue we index is
 * comfortably inside it. `watchCount` is the true total regardless, so a brand
 * that ever exceeds this says so honestly rather than under-reporting itself.
 */
const MAX_WATCHES = 120;

/**
 * The most Watches the sitemap will carry. Well above the current catalogue
 * (four stores, a few hundred watches); if it is ever reached the sitemap
 * needs paging, which is a different change.
 */
const MAX_INDEXABLE_WATCHES = 1000;

/**
 * What a brand page needs about one thing a brand sells — a Watch in the list
 * of what they make, or an accessory in the list of what else they sell.
 *
 * One select for both, because the two lists answer the same question at a
 * glance: what is it, what does it cost, can I have it. Two selects would be
 * two chances to describe the same row differently.
 */
const WATCH_SUMMARY_SELECT = {
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

type WatchSummaryRow = Prisma.WatchGetPayload<{
  select: typeof WATCH_SUMMARY_SELECT;
}>;

/**
 * A summary rather than the whole thing: the Watch's own page already carries
 * every way to buy it, so the brand page needs the cheapest price, a photo, and
 * whether it can be had at all.
 *
 * This is also what makes a Watch appear exactly once (#28) — the three store
 * products YEMA lists for the Superman Bronze CMM.10 are `variantCount: 3` on
 * one row, not three rows.
 *
 * Variants arrive cheapest-first, so `price` is the "from" figure. The photo is
 * borrowed from whichever variant has one — a store that photographs some
 * references and not others still shows something.
 */
function summariseWatch(row: WatchSummaryRow) {
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

/** What a brand's watches cost, cheapest to dearest. */
interface PriceBand {
  low: Prisma.Decimal;
  high: Prisma.Decimal;
  /** Null when the stores never said — see {@link priceBandFrom}. */
  currency: string | null;
}

/** One currency's worth of a brand's priced Variants, as `groupBy` returns it. */
type PriceGroup = {
  currency: string | null;
  _min: { price: Prisma.Decimal | null };
  _max: { price: Prisma.Decimal | null };
};

/**
 * What a brand's watches cost, read off their Variants rather than typed in by
 * anybody. Nothing here is editable, which is the point: a price band a human
 * maintains is a price band that goes stale and cannot be trusted.
 *
 * Three rules, and each is a thing that has already gone wrong somewhere:
 *
 * - **Two currencies means no band.** €990 to $1,400 is not a range, it is two
 *   numbers that cannot be compared, and a reader would take the smaller one
 *   for the entry price. Withholding is the only honest answer without a rate.
 * - **The label needs every priced Variant to agree.** A Shopify feed states a
 *   bare number and the currency is genuinely unknown (#24). One labelled
 *   sibling does not license labelling the rest — that is exactly how a €990
 *   watch came to be shown as $990.
 * - **A bare band is still a band.** Unlabelled numbers are what most stores
 *   give us, and refusing to show them would empty the section for nearly
 *   every brand.
 *
 * Accessories are the caller's job to exclude, and it matters: "from €60" on a
 * brand whose cheapest watch is €690 is a lie a reader catches one click later.
 */
function priceBandFrom(groups: PriceGroup[]): PriceBand | null {
  const priced = groups.filter((g) => g._min.price !== null);
  if (priced.length === 0) return null;

  const labelled = priced.filter((g) => g.currency !== null);
  if (labelled.length > 1) return null;

  const low = priced
    .map((g) => g._min.price as Prisma.Decimal)
    .reduce((a, b) => (b.lessThan(a) ? b : a));
  const high = priced
    .map((g) => g._max.price as Prisma.Decimal)
    .reduce((a, b) => (b.greaterThan(a) ? b : a));

  return {
    low,
    high,
    // One group, and it carried a currency: every priced Variant agreed.
    currency: priced.length === 1 ? priced[0].currency : null,
  };
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
          _count: {
            select: {
              // Published drops only — pending/rejected must not leak into the
              // UI.
              drops: { where: PUBLISHED },
              // What the card actually says out loud. A directory reading
              // "4 drops" next to a page reading "2 watches" is the same
              // inconsistency #28 fixes, one click earlier. Accessories are
              // excluded, or a brand's strap collection becomes its catalogue.
              watches: { where: { kind: WatchKind.watch } },
            },
          },
        },
      }),
    ]);
    return { total, count: brands.length, brands };
  }

  /**
   * Everything a Brand page renders, in the order it renders it (#28).
   *
   * The page leads with the Annotation, says what the brand costs, shows what
   * it makes, and only then what recently happened — because discovery is the
   * primary audience (CONTEXT.md §1) and the judgement is the thing a much
   * larger competitor's database does not have. Ordering is the page's job;
   * having all four to order is this method's.
   *
   * Three reads rather than one because a Brand's `watches` relation has to be
   * asked two different questions — what it makes, and what else it sells — and
   * the price band spans Variants the capped list may not include. They are
   * issued together rather than in sequence; a poll landing mid-flight could in
   * principle make the count and the list disagree by one, which is a cosmetic
   * risk not worth a transaction on the hottest read the site has.
   */
  async getBrandBySlug(slug: string, watchTake = MAX_WATCHES) {
    const safeTake = Math.min(Math.max(watchTake, 1), MAX_WATCHES);
    const [brand, watches, priceGroups] = await Promise.all([
      this.prisma.brand.findUnique({
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
          // Only a Curated Brand's Annotation is served. One sitting on a
          // Listed Brand is a draft nobody approved, and showing it would make
          // the state meaningless (ADR-0004, #22).
          annotation: true,
          annotationApprovedAt: true,
          drops: {
            where: PUBLISHED,
            orderBy: { publishedAt: 'desc' },
            select: DROP_SELECT,
          },
          // The straps, bracelets and boxes this brand sells. They raise no
          // Drop and interrupt nobody, but the data has been collected all
          // along and this is where a reader meets it (ADR-0006).
          watches: {
            where: { kind: WatchKind.accessory },
            orderBy: { name: 'asc' },
            // Capped like every other read here. YEMA alone lists over a
            // hundred straps and cases, and a brand page is not a shop.
            take: MAX_ACCESSORIES,
            select: WATCH_SUMMARY_SELECT,
          },
          // The headline count, and deliberately not `drops`: YEMA's page read
          // "4 drops tracked" for what a reader sees as two watches.
          _count: { select: { watches: { where: { kind: WatchKind.watch } } } },
        },
      }),
      this.prisma.watch.findMany({
        where: { brand: { slug }, kind: WatchKind.watch },
        orderBy: { name: 'asc' },
        take: safeTake,
        select: WATCH_SUMMARY_SELECT,
      }),
      // Every priced Variant of every Watch this brand makes — not only the
      // ones the cap let through, and never an accessory.
      this.prisma.watchVariant.groupBy({
        by: ['currency'],
        where: {
          price: { not: null },
          watch: { brand: { slug }, kind: WatchKind.watch },
        },
        // Required by `groupBy`, and irrelevant to the answer — the band is a
        // min and a max over whatever comes back, in whatever order.
        orderBy: { currency: 'asc' },
        _min: { price: true },
        _max: { price: true },
      }),
    ]);
    if (!brand) throw new NotFoundException(`Brand not found: ${slug}`);
    const {
      watches: accessories,
      annotation,
      annotationApprovedAt,
      _count,
      ...rest
    } = brand;
    const curated = brand.status === BrandStatus.curated;
    return {
      ...rest,
      // Withheld unless approved. The website cannot show what it never
      // receives, which is a stronger guarantee than asking it to check.
      annotation: curated ? annotation : null,
      annotationApprovedAt: curated ? annotationApprovedAt : null,
      priceBand: priceBandFrom(priceGroups),
      // The true total, which `watches` is not once the cap bites.
      watchCount: _count.watches,
      watches: watches.map(summariseWatch).sort(buyableFirst),
      drops: oneDropPerWatch(brand.drops).map(flattenDrop),
      accessories: accessories.map(summariseWatch).sort(buyableFirst),
    };
  }

  /**
   * Every Watch worth indexing, for the sitemap.
   *
   * Watches only. An accessory is a Watch row with `kind = 'accessory'`, and
   * asking Google to index a gift card is the read-side version of announcing
   * one (ADR-0006).
   *
   * Ordered by when each was last touched, so the cap keeps the pages most
   * likely to have changed rather than an arbitrary slice. Not pageable, and
   * capped at {@link MAX_INDEXABLE_WATCHES}: the roster is four stores and a
   * few hundred watches, and a sitemap that needs paging is a problem worth
   * solving when it exists rather than before.
   */
  async listWatches(take = 200) {
    const safeTake = Math.min(Math.max(take, 1), MAX_INDEXABLE_WATCHES);
    const watches = await this.prisma.watch.findMany({
      where: { kind: WatchKind.watch },
      orderBy: { updatedAt: 'desc' },
      take: safeTake,
      select: {
        slug: true,
        updatedAt: true,
        brand: { select: { slug: true } },
      },
    });
    return { count: watches.length, watches };
  }

  /**
   * The Watch a Drop is about, so its URL can send a reader there.
   *
   * A Drop is an event and makes a poor landing page — "Baltic restocked on
   * 4 August" is a bad thing to rank for and a worse thing to arrive at three
   * months later.
   *
   * **Every `/drops/<id>` URL has to keep working.** Not because the Channels
   * carry them — they never have, they link to the Brand page and the store —
   * but because those URLs were in the sitemap, so search engines hold them,
   * and readers may have shared them. A 404 throws that away instead of
   * passing it to the page that deserves it.
   *
   * Deliberately **not** filtered by {@link ABOUT_A_WATCH}, unlike everything
   * else that serves a Drop. An accessory Drop must not render as a release —
   * and #41 made it 404, which quietly broke this rule for every accessory URL
   * Google had already crawled. Redirecting to the accessory's own page
   * satisfies both: it is not served as a Drop, and the link still lands.
   *
   * A Drop nobody was ever shown — unpublished, or rejected — was never in a
   * sitemap and is a genuine 404.
   */
  async getDropWatch(id: string) {
    const drop = await this.prisma.drop.findFirst({
      where: {
        id,
        moderationStatus: ModerationStatus.approved,
        publishedAt: { not: null },
      },
      select: {
        id: true,
        watch: { select: { slug: true, brand: { select: { slug: true } } } },
      },
    });
    if (!drop) throw new NotFoundException(`Drop not found: ${id}`);
    return {
      dropId: drop.id,
      watch: drop.watch
        ? { brandSlug: drop.watch.brand.slug, watchSlug: drop.watch.slug }
        : null,
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
