/**
 * A poll that finds nothing anybody could be told about writes nothing down.
 *
 * YEMA's store rotates its market price lists, so its catalogue hash moved six
 * to eight times a day and every one of those snapshots was a no-op: a stored
 * payload nobody would ever read, written because a number nobody is alerted on
 * had wobbled (#25).
 *
 * The catalogue is the other half. A price that moves is real even when it is
 * not news, so the brand page has to keep showing the current one — quieting the
 * snapshot must not quietly staleness the site.
 */
import { ConfigService } from '@nestjs/config';
import { SourceType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AlertDispatchService } from '../alerts/alert-dispatch.service';
import { CapturingTelegram } from '../../test/capturing-telegram';
import { DropWriterService } from '../drops/drop-writer.service';
import { PrismaService } from '../prisma/prisma.service';
import { LinkProbe } from './link-probe';
import { RobotsService } from './robots.service';
import { FetchResult, SiteFetcher } from './site-fetcher';
import { SiteWatchService } from './site-watch.service';
import { WatchWriterService } from './watch-writer.service';

const ENDPOINT = 'https://brand.example/products.json';

interface Listing {
  handle: string;
  title?: string;
  price?: string;
  available?: boolean;
  image?: string;
}

class StubFetcher extends SiteFetcher {
  next: FetchResult = { status: 200, body: '{"products":[]}' };
  robotsTxt = '';

  async fetch(url: string): Promise<FetchResult> {
    if (url.endsWith('/robots.txt')) {
      return { status: this.robotsTxt ? 200 : 404, body: this.robotsTxt };
    }
    // Any product page a link check asks about is alive; this file is about
    // snapshots, not about dead links.
    if (/\/products\/[^/?#]+$/.test(url)) {
      return { status: 200, body: '<html></html>' };
    }
    return this.next;
  }

  serve(products: Listing[]) {
    this.next = {
      status: 200,
      body: JSON.stringify({
        products: products.map((p) => ({
          handle: p.handle,
          title: p.title ?? p.handle,
          variants: [
            { available: p.available ?? true, price: p.price ?? '500.00' },
          ],
          images: p.image ? [{ src: p.image }] : [],
        })),
      }),
    };
  }
}

describe('SiteWatchService — a poll with nothing to announce', () => {
  let prisma: PrismaService;
  let fetcher: StubFetcher;
  let robots: RobotsService;
  let service: SiteWatchService;
  const brandIds: string[] = [];
  const sourceIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    fetcher = new StubFetcher();
    const config = new ConfigService({
      digest: { publicWebUrl: 'https://crownswatch.org' },
      siteWatch: {
        userAgent: 'CrownWatchBot/0.1 (+https://crownswatch.org)',
        pollDelayMs: 0,
      },
      telegram: {
        botToken: 'test-token',
        channels: { uk: '@crownwatch_ua', en: '@crownwatch_en' },
      },
    });
    robots = new RobotsService(fetcher, config);
    service = new SiteWatchService(
      prisma,
      fetcher,
      new DropWriterService(prisma),
      new WatchWriterService(prisma),
      new AlertDispatchService(prisma, config, new CapturingTelegram()),
      robots,
      new LinkProbe(fetcher, robots),
      config,
    );
  });

  beforeEach(() => {
    fetcher.robotsTxt = '';
    robots.clearCache();
  });

  afterAll(async () => {
    await prisma.drop.deleteMany({ where: { brandId: { in: brandIds } } });
    await prisma.rawIngestionEvent.deleteMany({
      where: { sourceId: { in: sourceIds } },
    });
    await prisma.source.deleteMany({ where: { id: { in: sourceIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  /** A brand with a store, already baselined on `listings`. */
  async function arrangeBaselined(listings: Listing[]) {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: { name: `Watch Co ${tag}`, slug: `watch-co-${tag}` },
    });
    brandIds.push(brand.id);
    const source = await prisma.source.create({
      data: {
        type: SourceType.site_watch,
        name: 'Store',
        endpoint: `${ENDPOINT}?s=${randomUUID()}`,
        brandId: brand.id,
        watchConfig: { adapter: 'shopify_products_json', currency: 'EUR' },
      },
    });
    sourceIds.push(source.id);
    fetcher.serve(listings);
    await service.pollSource(source.id);
    return { source, brandId: brand.id };
  }

  const snapshotCount = (sourceId: string) =>
    prisma.rawIngestionEvent.count({ where: { sourceId } });

  const dropCount = (brandId: string) =>
    prisma.drop.count({ where: { brandId } });

  const variantFor = async (brandId: string, handle: string) => {
    const variants = await prisma.watchVariant.findMany({
      where: { watch: { brandId }, productUrl: { contains: `/products/${handle}` } },
    });
    return variants[0];
  };

  describe('a price that moved and nothing else', () => {
    it('stores no new snapshot', async () => {
      // The whole ticket. Six to eight of these a day, per source, each one a
      // stored payload nobody will ever read.
      const { source } = await arrangeBaselined([
        { handle: 'aquascaphe', price: '500.00' },
      ]);

      fetcher.serve([{ handle: 'aquascaphe', price: '450.00' }]);
      const result = await service.pollSource(source.id);

      expect(await snapshotCount(source.id)).toBe(1);
      expect(result.snapshotStored).toBe(false);
    });

    it('still says the store moved, because it did', async () => {
      const { source } = await arrangeBaselined([
        { handle: 'aquascaphe', price: '500.00' },
      ]);

      fetcher.serve([{ handle: 'aquascaphe', price: '450.00' }]);
      const result = await service.pollSource(source.id);

      expect(result.changed).toBe(true);
      expect(result.status).toBe('ok');
    });

    it('announces nothing', async () => {
      const { source, brandId } = await arrangeBaselined([
        { handle: 'aquascaphe', price: '500.00' },
      ]);

      fetcher.serve([{ handle: 'aquascaphe', price: '450.00' }]);
      const result = await service.pollSource(source.id);

      expect(result.dropsCreated).toBe(0);
      expect(await dropCount(brandId)).toBe(0);
    });

    it('still writes the new price to the catalogue', async () => {
      // The brand page and the price band read from Variants, not from the
      // snapshot. Quieting the snapshot must not staleness the site.
      const { source, brandId } = await arrangeBaselined([
        { handle: 'aquascaphe', price: '500.00' },
      ]);

      fetcher.serve([{ handle: 'aquascaphe', price: '450.00' }]);
      await service.pollSource(source.id);

      const variant = await variantFor(brandId, 'aquascaphe');
      expect(Number(variant.price)).toBe(450);
    });

    it('still writes a swapped photograph to the catalogue', async () => {
      const { source, brandId } = await arrangeBaselined([
        { handle: 'aquascaphe', image: 'https://cdn.example/old.jpg' },
      ]);

      fetcher.serve([
        { handle: 'aquascaphe', image: 'https://cdn.example/new.jpg' },
      ]);
      await service.pollSource(source.id);

      const variant = await variantFor(brandId, 'aquascaphe');
      expect(variant.imageUrl).toBe('https://cdn.example/new.jpg');
    });
  });

  describe('a price that moved once and then stayed put', () => {
    it('goes quiet on the next poll, instead of re-recording for ever', async () => {
      // The trap in comparing against the last *stored* snapshot: a store that
      // moves its price once and never again would look changed at every poll
      // from then on, because the baseline it is compared against still holds
      // the old price. YEMA's A/B rotation is the loud case; a one-way price
      // change is the quiet one, and it would have re-upserted every Variant
      // hourly, for ever.
      const { source, brandId } = await arrangeBaselined([
        { handle: 'aquascaphe', price: '500.00' },
      ]);

      fetcher.serve([{ handle: 'aquascaphe', price: '450.00' }]);
      const moved = await service.pollSource(source.id);
      expect(moved.changed).toBe(true);
      expect(moved.snapshotStored).toBe(false);

      const before = await prisma.watchVariant.findMany({
        where: { watch: { brandId } },
        select: { lastSeenAt: true },
      });

      // The store now says exactly what it said last poll.
      const settled = await service.pollSource(source.id);

      expect(settled.changed).toBe(false);
      expect(settled.snapshotStored).toBe(false);
      expect(await snapshotCount(source.id)).toBe(1);
      const after = await prisma.watchVariant.findMany({
        where: { watch: { brandId } },
        select: { lastSeenAt: true },
      });
      expect(after.map((v) => v.lastSeenAt.toISOString())).toEqual(
        before.map((v) => v.lastSeenAt.toISOString()),
      );
    });

    it('still diffs the next real change against the right baseline', async () => {
      // Whatever keeps the comparison honest must not corrupt what the diff
      // reads: novelty and availability still have to be judged against the
      // last announceable state.
      const { source, brandId } = await arrangeBaselined([
        { handle: 'aquascaphe', price: '500.00', available: false },
      ]);

      fetcher.serve([{ handle: 'aquascaphe', price: '450.00', available: false }]);
      await service.pollSource(source.id);
      await service.pollSource(source.id);

      // Now it comes back in stock — a restock against a baseline that has been
      // sitting through price moves.
      fetcher.serve([{ handle: 'aquascaphe', price: '450.00', available: true }]);
      const result = await service.pollSource(source.id);

      expect(result.dropsCreated).toBe(1);
      expect(result.changes[0].kind).toBe('restock');
      expect(await dropCount(brandId)).toBe(1);
    });
  });

  describe('a store that has not moved at all', () => {
    it('writes nothing whatsoever', async () => {
      const { source, brandId } = await arrangeBaselined([
        { handle: 'aquascaphe', price: '500.00' },
      ]);
      const before = await prisma.watchVariant.findMany({
        where: { watch: { brandId } },
        select: { id: true, lastSeenAt: true },
      });

      const result = await service.pollSource(source.id);

      expect(await snapshotCount(source.id)).toBe(1);
      expect(result.snapshotStored).toBe(false);
      expect(result.changed).toBe(false);
      // Not even a touched timestamp: an unchanged store is not news for the
      // catalogue either.
      const after = await prisma.watchVariant.findMany({
        where: { watch: { brandId } },
        select: { id: true, lastSeenAt: true },
      });
      expect(after.map((v) => v.lastSeenAt.toISOString())).toEqual(
        before.map((v) => v.lastSeenAt.toISOString()),
      );
    });
  });

  describe('what must still get through', () => {
    it('announces a product URL never seen before', async () => {
      const { source, brandId } = await arrangeBaselined([
        { handle: 'aquascaphe' },
      ]);

      fetcher.serve([{ handle: 'aquascaphe' }, { handle: 'scalegraph' }]);
      const result = await service.pollSource(source.id);

      expect(result.dropsCreated).toBe(1);
      expect(result.snapshotStored).toBe(true);
      expect(await snapshotCount(source.id)).toBe(2);
      expect(await dropCount(brandId)).toBe(1);
    });

    it('announces availability turning true', async () => {
      const { source } = await arrangeBaselined([
        { handle: 'aquascaphe', available: false },
      ]);

      fetcher.serve([{ handle: 'aquascaphe', available: true }]);
      const result = await service.pollSource(source.id);

      expect(result.dropsCreated).toBe(1);
      expect(result.changes[0].kind).toBe('restock');
      expect(result.snapshotStored).toBe(true);
    });

    it('stores a snapshot when a title changes, though it announces nothing', async () => {
      // A retitle raises no Drop, but the stored titles decide how the previous
      // state groups. Letting them go stale is how a Watch's delisted
      // references fall out of `wasBuyable` and a false restock goes out.
      const { source, brandId } = await arrangeBaselined([
        { handle: 'aquascaphe', title: 'Aquascaphe' },
      ]);

      fetcher.serve([{ handle: 'aquascaphe', title: 'Aquascaphe Bronze' }]);
      const result = await service.pollSource(source.id);

      expect(result.snapshotStored).toBe(true);
      expect(result.dropsCreated).toBe(0);
      expect(await dropCount(brandId)).toBe(0);
    });
  });

  describe('a source the flood guard is holding', () => {
    it('is released when the store comes back to what we hold, price wobble and all', async () => {
      // ADR-0005 ends a hold when "the store returns to the catalogue we
      // already hold". Under the narrowed identity that now includes a return
      // whose prices have drifted — because prices were never what was being
      // held back. Before #25 such a source stayed held until a human
      // intervened, for a difference nobody could have been told about.
      const { source } = await arrangeBaselined([{ handle: 'aquascaphe' }]);

      // A flood: refused, and the source is held.
      fetcher.serve([
        { handle: 'aquascaphe' },
        ...Array.from({ length: 12 }, (_, i) => ({ handle: `flood-${i}` })),
      ]);
      const refused = await service.pollSource(source.id);
      expect(refused.status).toBe('refused');
      expect(refused.health).toBe('held');

      // The store reverts — but its price list has rotated meanwhile.
      fetcher.serve([{ handle: 'aquascaphe', price: '444.00' }]);
      const result = await service.pollSource(source.id);

      expect(result.status).toBe('ok');
      expect(result.health).toBe('healthy');
      expect(result.dropsCreated).toBe(0);
      expect(result.snapshotStored).toBe(false);
    });

    it('stays held while the flood is still there, whatever the prices say', async () => {
      // The guard must not be talked round by a price change.
      const { source } = await arrangeBaselined([{ handle: 'aquascaphe' }]);
      const flood = Array.from({ length: 12 }, (_, i) => ({
        handle: `flood-${i}`,
      }));

      fetcher.serve([{ handle: 'aquascaphe' }, ...flood]);
      expect((await service.pollSource(source.id)).status).toBe('refused');

      fetcher.serve([
        { handle: 'aquascaphe', price: '999.00' },
        ...flood.map((f) => ({ ...f, price: '888.00' })),
      ]);
      const result = await service.pollSource(source.id);

      expect(result.status).toBe('refused');
      expect(result.health).toBe('held');
    });
  });

  describe('the snapshot a quiet poll left in place', () => {
    it('is what the next real change is diffed against', async () => {
      // The danger of not storing: the surviving snapshot has to still be a
      // usable baseline several quiet polls later.
      const { source, brandId } = await arrangeBaselined([
        { handle: 'aquascaphe', price: '500.00' },
      ]);

      // Three polls of pure price wobble.
      for (const price of ['450.00', '520.00', '480.00']) {
        fetcher.serve([{ handle: 'aquascaphe', price }]);
        await service.pollSource(source.id);
      }
      expect(await snapshotCount(source.id)).toBe(1);

      // Then something real.
      fetcher.serve([
        { handle: 'aquascaphe', price: '480.00' },
        { handle: 'scalegraph', price: '900.00' },
      ]);
      const result = await service.pollSource(source.id);

      expect(result.dropsCreated).toBe(1);
      expect(result.changes[0].title).toBe('scalegraph');
      expect(await dropCount(brandId)).toBe(1);
      expect(await snapshotCount(source.id)).toBe(2);
    });

    it('does not re-announce the wobble it slept through', async () => {
      // The stored snapshot still holds the old price. Since a Drop is built
      // from the live fetch, the announcement carries the current one.
      const { source } = await arrangeBaselined([
        { handle: 'aquascaphe', price: '500.00' },
      ]);

      fetcher.serve([{ handle: 'aquascaphe', price: '450.00' }]);
      await service.pollSource(source.id);
      fetcher.serve([
        { handle: 'aquascaphe', price: '450.00' },
        { handle: 'scalegraph', price: '900.00' },
      ]);
      const result = await service.pollSource(source.id);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].title).toBe('scalegraph');
    });
  });
});
