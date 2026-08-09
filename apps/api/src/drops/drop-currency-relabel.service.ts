import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DropCurrencyChange {
  dropId: string;
  brandName: string;
  title: string;
  from: string | null;
  to: string | null;
  /** Why the new answer is what it is, for the dry run to print. */
  because: string;
}

export interface DropCurrencyRelabelResult {
  dryRun: boolean;
  /** Drops attached to a Watch — the only ones this considers. */
  examined: number;
  changes: DropCurrencyChange[];
  updated: number;
  /**
   * Drops left alone because they are about no Watch. An RSS-extracted Drop's
   * currency was read out of a publication's prose, not from the registration
   * label this replaces, so it is none of this script's business.
   */
  skippedWithoutWatch: number;
}

/**
 * Re-derive the currency on Drops the watcher already published.
 *
 * Until #24 the label came from `watch_config.currency`, typed once when a
 * source was registered. YEMA serves several market price lists, so roughly
 * half its Drops carry a label nobody can stand behind.
 *
 * **Evidence, not a blanket wipe.** A Drop's Watch owns Variants, and those are
 * rewritten from the store on every poll that sees a change — so after #24 has
 * been deployed and each store polled once, the Variants carry what the store
 * actually printed. Where they agree on one currency, the Drop gets it (which
 * leaves Baltic's `EUR` exactly where it was, correctly). Where they no longer
 * evidence one — every Shopify-fed store — the Drop is cleared, because a bare
 * number beats a wrong one.
 *
 * Nothing else is touched: no price, no publication state, no broadcast row.
 */
@Injectable()
export class DropCurrencyRelabelService {
  constructor(private readonly prisma: PrismaService) {}

  async relabel(
    options: { confirm?: boolean } = {},
  ): Promise<DropCurrencyRelabelResult> {
    const dryRun = options.confirm !== true;

    const [withoutWatch, drops] = await Promise.all([
      this.prisma.drop.count({ where: { watchId: null } }),
      this.prisma.drop.findMany({
        where: { watchId: { not: null } },
        select: {
          id: true,
          title: true,
          currency: true,
          brand: { select: { name: true } },
          watch: {
            select: {
              variants: { select: { currency: true, price: true } },
            },
          },
        },
        orderBy: { publishedAt: 'asc' },
      }),
    ]);

    const changes: DropCurrencyChange[] = [];
    for (const drop of drops) {
      const evidenced = this.evidencedCurrency(drop.watch?.variants ?? []);
      if (evidenced.currency === drop.currency) continue;
      changes.push({
        dropId: drop.id,
        brandName: drop.brand.name,
        title: drop.title,
        from: drop.currency,
        to: evidenced.currency,
        because: evidenced.because,
      });
    }

    let updated = 0;
    if (!dryRun) {
      for (const change of changes) {
        await this.prisma.drop.update({
          where: { id: change.dropId },
          data: { currency: change.to },
        });
        updated += 1;
      }
    }

    return {
      dryRun,
      examined: drops.length,
      changes,
      updated,
      skippedWithoutWatch: withoutWatch,
    };
  }

  /**
   * The one currency this Watch's priced Variants agree on, or null.
   *
   * Unpriced Variants are ignored — a Variant with no price says nothing about
   * what a price would be denominated in. Disagreement resolves to null rather
   * than to a majority: picking the commoner of two is the same guess this
   * whole change removed.
   */
  private evidencedCurrency(
    variants: Array<{ currency: string | null; price: unknown }>,
  ): { currency: string | null; because: string } {
    const priced = variants.filter((v) => v.price !== null);
    if (priced.length === 0) {
      return { currency: null, because: 'no priced variant to read' };
    }
    const distinct = new Set(priced.map((v) => v.currency ?? null));
    if (distinct.size > 1) {
      return { currency: null, because: 'variants disagree' };
    }
    const [only] = [...distinct];
    return only
      ? { currency: only, because: 'every priced variant says so' }
      : { currency: null, because: 'the store does not say' };
  }
}
