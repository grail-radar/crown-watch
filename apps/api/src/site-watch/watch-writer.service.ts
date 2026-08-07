import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductSnapshot } from './snapshot';
import { WatchIdentity, watchIdentity } from './watch-identity';

/**
 * Records what a brand currently sells as **Watches** with **Variants**
 * beneath them.
 *
 * Catalogue, not events. This runs on every poll including the very first —
 * a brand-new source records a silent baseline and announces nothing, but it
 * still knows what the brand makes, so the pages have something on them from
 * the moment a store is registered.
 *
 * Idempotent by construction, because a poll of an unchanged store runs through
 * here every hour: a Watch is keyed on its identity, a Variant on its product
 * URL. Getting that wrong would grow a duplicate catalogue by the day.
 */
@Injectable()
export class WatchWriterService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    brandId: string,
    brandSlug: string,
    products: ProductSnapshot[],
  ): Promise<{ watches: number; variants: number }> {
    const groups = new Map<
      string,
      { identity: WatchIdentity; entries: Array<{ product: ProductSnapshot; identity: WatchIdentity }> }
    >();

    for (const product of products) {
      // Computed once and carried: the rule is pure, but it is also the hot
      // path for a store with two hundred products.
      const identity = watchIdentity(brandSlug, product.title);
      const group = groups.get(identity.key) ?? { identity, entries: [] };
      group.entries.push({ product, identity });
      groups.set(identity.key, group);
    }

    let variants = 0;

    for (const { identity, entries } of groups.values()) {
      const watch = await this.watchFor(
        brandId,
        identity,
        entries.map((e) => e.product.url),
      );

      for (const { product, identity: own } of entries) {
        const fields = {
          watchId: watch.id,
          reference: own.reference,
          price: product.price,
          currency: product.currency,
          imageUrl: product.imageUrl,
          available: product.available,
        };
        await this.prisma.watchVariant.upsert({
          // Keyed on the URL, not on (watch, url): the same URL is the same
          // thing in the world, so a store retitling a product moves its
          // variant to the right Watch instead of duplicating it under both.
          where: { productUrl: product.url },
          create: { productUrl: product.url, ...fields },
          update: fields,
        });
        variants += 1;
      }
    }

    return { watches: groups.size, variants };
  }

  /**
   * The Watch these products belong to, creating it only when it is genuinely
   * new.
   *
   * The subtle case is a **retitle**. A store renaming a product changes the
   * identity key, so keying alone would make a second Watch and leave the first
   * with nothing to buy — a dead page at a URL somebody may already have
   * shared. When the products already belong to exactly one Watch and are the
   * whole of it, that is a rename, not a new model: the row is kept, and with
   * it the slug.
   */
  private async watchFor(
    brandId: string,
    identity: WatchIdentity,
    productUrls: string[],
  ) {
    const byKey = await this.prisma.watch.findUnique({
      where: { brandId_key: { brandId, key: identity.key } },
    });
    if (byKey) {
      return this.prisma.watch.update({
        where: { id: byKey.id },
        data: { name: identity.name },
      });
    }

    const owners = await this.prisma.watch.findMany({
      where: { brandId, variants: { some: { productUrl: { in: productUrls } } } },
      select: { id: true, _count: { select: { variants: true } } },
    });

    // Exactly one owner, and these products are all of it — so moving them
    // would empty it. That is the same watch under a new name.
    if (owners.length === 1 && owners[0]._count.variants === productUrls.length) {
      return this.prisma.watch.update({
        where: { id: owners[0].id },
        // The slug is deliberately not recomputed. A reader may already have
        // the URL, and a store tidying a title is not a reason to break it.
        data: { key: identity.key, name: identity.name },
      });
    }

    return this.prisma.watch.create({
      data: {
        brandId,
        key: identity.key,
        name: identity.name,
        slug: await this.freeSlug(brandId, identity.slug),
      },
    });
  }

  /**
   * A slug nothing else in this brand is using.
   *
   * Two genuinely different watches can reduce to one slug — "Panda!" and
   * "Panda?" both give `panda` — and the unique index would fail the whole poll
   * over it. Suffixing is unlovely but it keeps one bad name from costing a
   * brand its entire catalogue update.
   */
  private async freeSlug(brandId: string, base: string): Promise<string> {
    for (let suffix = 0; suffix < 50; suffix += 1) {
      const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
      const taken = await this.prisma.watch.findUnique({
        where: { brandId_slug: { brandId, slug: candidate } },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    // Fifty collisions on one name is not a naming clash any more; make it
    // unique and let it be visibly odd rather than failing the poll.
    return `${base}-${Date.now()}`;
  }
}
