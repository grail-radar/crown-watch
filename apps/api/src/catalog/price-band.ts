import { Prisma } from '@prisma/client';
import { WatchKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** What a brand's watches cost, cheapest to dearest. */
export interface PriceBand {
  low: Prisma.Decimal;
  high: Prisma.Decimal;
  /** Null when the stores never said — see {@link priceBandFrom}. */
  currency: string | null;
}

/** One currency's worth of a brand's priced Variants, as `groupBy` returns it. */
export type PriceGroup = {
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
 *
 *   *Unknown* is not a second currency. A store that labels some of its prices
 *   and not others is one store in one currency that happens to be inconsistent
 *   about saying so, and a brand prices in its own store — so those numbers do
 *   compare, and the band spans them.
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
export function priceBandFrom(groups: PriceGroup[]): PriceBand | null {
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
 * The band for one Brand, straight from its Variants.
 *
 * Two callers now need the same answer — the Brand page serves it to a reader,
 * and an Annotation draft puts it in front of whoever writes the sentence — so
 * the query lives with the rule rather than beside one of them. A second
 * derivation of "what does this brand cost" is a second chance to disagree.
 */
export async function priceBandFor(
  prisma: PrismaService,
  brandId: string,
): Promise<PriceBand | null> {
  const groups = await prisma.watchVariant.groupBy({
    by: ['currency'],
    where: {
      price: { not: null },
      watch: { brandId, kind: WatchKind.watch },
    },
    orderBy: { currency: 'asc' },
    _min: { price: true },
    _max: { price: true },
  });
  return priceBandFrom(groups);
}
