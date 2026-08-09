/**
 * What search engines are told to index, and where an old Drop URL goes.
 *
 * `CONTEXT.md` §2 makes SEO the primary organic growth channel, and a Drop is
 * the wrong thing to rank for: "Baltic restocked on 4 August" is a bad search
 * result and a worse landing page three months later. A Watch is the durable
 * object people search for.
 *
 * The constraint that shapes all of it: **no URL that served a page may start
 * 404ing.** Not because the Channels carry Drop URLs — they never have, they
 * link to the Brand page — but because those URLs were in the sitemap, so
 * search engines hold them, and readers may have shared them.
 */
import { DropType, ModerationStatus, WatchKind } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from './catalog.service';

describe('CatalogService — what gets indexed', () => {
  let prisma: PrismaService;
  let catalog: CatalogService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    catalog = new CatalogService(prisma);
  });

  afterAll(async () => {
    await prisma.drop.deleteMany({ where: { brandId: { in: brandIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function arrangeBrand() {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: { name: `Baltic ${tag}`, slug: `baltic-${tag}` },
    });
    brandIds.push(brand.id);
    return brand;
  }

  async function arrangeWatch(
    brandId: string,
    name: string,
    kind: WatchKind = WatchKind.watch,
  ) {
    const tag = randomUUID().slice(0, 8);
    return prisma.watch.create({
      data: {
        brandId,
        kind,
        key: `${name.toLowerCase()}-${tag}`,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${tag}`,
        name,
      },
    });
  }

  const arrangeDrop = (
    brandId: string,
    over: { watchId?: string | null; published?: boolean; title?: string } = {},
  ) =>
    prisma.drop.create({
      data: {
        brandId,
        watchId: over.watchId ?? null,
        title: over.title ?? 'Aquascaphe',
        type: DropType.pre_order,
        moderationStatus:
          over.published === false
            ? ModerationStatus.pending
            : ModerationStatus.approved,
        publishedAt: over.published === false ? null : new Date(),
      },
    });

  describe('the sitemap', () => {
    it('lists watches with the brand they belong to', async () => {
      const brand = await arrangeBrand();
      const watch = await arrangeWatch(brand.id, 'Aquascaphe');

      const { watches } = await catalog.listWatches(200);

      const mine = watches.find((w) => w.slug === watch.slug);
      expect(mine).toBeDefined();
      expect(mine?.brand.slug).toBe(brand.slug);
      expect(mine?.updatedAt).toBeInstanceOf(Date);
    });

    it('leaves accessories out of it', async () => {
      // The whole point of #38 read from the other end: a gift card is not
      // something anybody should find in a search result.
      const brand = await arrangeBrand();
      const watch = await arrangeWatch(brand.id, 'Scalegraph');
      const card = await arrangeWatch(brand.id, 'Gift Card', WatchKind.accessory);

      const { watches } = await catalog.listWatches(200);

      const slugs = watches.map((w) => w.slug);
      expect(slugs).toContain(watch.slug);
      expect(slugs).not.toContain(card.slug);
    });

    it('honours the take it is given', async () => {
      const { watches } = await catalog.listWatches(1);

      expect(watches).toHaveLength(1);
    });

    it('will not be talked into an unbounded read', async () => {
      // The sitemap asks for a thousand. Anything larger is clamped, so a
      // caller cannot turn the sitemap into a full table scan by asking.
      const asked = await catalog.listWatches(50_000);
      const capped = await catalog.listWatches(1000);

      expect(asked.watches.length).toBe(capped.watches.length);
    });
  });

  describe('where an old Drop URL goes', () => {
    it('sends a Drop to the Watch it is about', async () => {
      const brand = await arrangeBrand();
      const watch = await arrangeWatch(brand.id, 'Aquascaphe');
      const drop = await arrangeDrop(brand.id, { watchId: watch.id });

      const target = await catalog.getDropWatch(drop.id);

      expect(target.watch).toEqual({
        brandSlug: brand.slug,
        watchSlug: watch.slug,
      });
    });

    it('leaves a Drop that is about no Watch where it is', async () => {
      // An RSS-extracted Drop names a watch in prose and has no store product.
      // Its own page is the only thing it has, so it keeps it.
      const brand = await arrangeBrand();
      const drop = await arrangeDrop(brand.id, { watchId: null });

      const target = await catalog.getDropWatch(drop.id);

      expect(target.watch).toBeNull();
    });

    it('still redirects an accessory Drop rather than dropping it on the floor', async () => {
      // #41 stopped serving these as Drops, which would have turned a URL that
      // used to render into a 404 — including URLs sitting in a Channel. They
      // resolve to the accessory's own page instead.
      const brand = await arrangeBrand();
      const strap = await arrangeWatch(brand.id, 'Leather Strap', WatchKind.accessory);
      const drop = await arrangeDrop(brand.id, {
        watchId: strap.id,
        title: 'Leather Strap',
      });

      const target = await catalog.getDropWatch(drop.id);

      expect(target.watch).toEqual({
        brandSlug: brand.slug,
        watchSlug: strap.slug,
      });
    });

    it('404s a Drop nobody was ever shown', async () => {
      // Never published, so no link to it can exist in the wild.
      const brand = await arrangeBrand();
      const drop = await arrangeDrop(brand.id, { published: false });

      await expect(catalog.getDropWatch(drop.id)).rejects.toThrow(
        /not found/i,
      );
    });

    it('404s an id that is not a drop at all', async () => {
      await expect(catalog.getDropWatch('nope')).rejects.toThrow(
        /not found/i,
      );
    });

    it('tells the feed which Watch each Drop is about, so a card skips the hop', async () => {
      const brand = await arrangeBrand();
      const watch = await arrangeWatch(brand.id, 'Scalegraph');
      await arrangeDrop(brand.id, { watchId: watch.id, title: 'Scalegraph' });
      await arrangeDrop(brand.id, { watchId: null, title: 'Covered elsewhere' });

      const feed = await catalog.listPublishedDrops(200);

      const linked = feed.drops.find((d) => d.title === 'Scalegraph');
      const orphan = feed.drops.find((d) => d.title === 'Covered elsewhere');
      expect(linked?.watch).toEqual({
        brandSlug: brand.slug,
        watchSlug: watch.slug,
      });
      expect(orphan?.watch).toBeNull();
    });
  });
});
