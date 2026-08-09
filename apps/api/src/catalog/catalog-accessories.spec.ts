/**
 * What a reader is served about the things a brand sells that are not watches.
 *
 * Two halves, and the first matters more: an accessory must never appear as a
 * Drop in the public feed, including the ones announced before #38 taught the
 * watcher the difference. Those Drops are real history and stay in the
 * database — they simply stop being served (ADR-0006).
 */
import { ConfigService } from '@nestjs/config';
import { DropType, ModerationStatus, WatchKind } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AlertDispatchService } from '../alerts/alert-dispatch.service';
import { CapturingTelegram } from '../../test/capturing-telegram';
import { DigestSenderService } from '../digest/digest-sender.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from './catalog.service';

const UK_CHANNEL = '@crownwatch_ua';
const EN_CHANNEL = '@crownwatch_en';

describe('CatalogService — accessories', () => {
  let prisma: PrismaService;
  let catalog: CatalogService;
  let telegram: CapturingTelegram;
  let alerts: AlertDispatchService;
  let digest: DigestSenderService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    catalog = new CatalogService(prisma);
    telegram = new CapturingTelegram();
    const config = new ConfigService({
      digest: {
        publicWebUrl: 'https://crownswatch.org',
        publicApiUrl: 'https://api.crownswatch.org',
        from: 'Crown Watch <test@example.com>',
      },
      telegram: {
        botToken: 'test-token',
        channels: { uk: UK_CHANNEL, en: EN_CHANNEL },
      },
    });
    alerts = new AlertDispatchService(prisma, config, telegram);
    digest = new DigestSenderService(prisma, config);
  });

  beforeEach(() => {
    telegram.sent = [];
  });

  afterAll(async () => {
    await prisma.drop.deleteMany({ where: { brandId: { in: brandIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function arrangeBrand() {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: { name: `YEMA ${tag}`, slug: `yema-${tag}`, website: 'https://yema.example' },
    });
    brandIds.push(brand.id);
    return brand;
  }

  async function arrangeWatch(
    brandId: string,
    name: string,
    kind: WatchKind,
    variants: Array<{ price?: number | null; available?: boolean; image?: string | null }> = [{}],
  ) {
    const tag = randomUUID().slice(0, 8);
    return prisma.watch.create({
      data: {
        brandId,
        kind,
        key: `${name.toLowerCase()}-${tag}`,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${tag}`,
        name,
        variants: {
          create: variants.map((v, i) => ({
            // Unique across the whole database by design: a product URL
            // identifies one thing in the world.
            productUrl: `https://yema.example/products/${tag}-${i}`,
            price: v.price === undefined ? 90 : v.price,
            currency: 'EUR',
            imageUrl: v.image === undefined ? 'https://cdn.example/strap.jpg' : v.image,
            available: v.available ?? true,
          })),
        },
      },
    });
  }

  /** A published Drop, as the watcher would have written it before #38. */
  const arrangeDrop = (brandId: string, watchId: string, title: string) =>
    prisma.drop.create({
      data: {
        brandId,
        watchId,
        title,
        type: DropType.pre_order,
        moderationStatus: ModerationStatus.approved,
        publishedAt: new Date(),
      },
    });

  describe('an accessory never appears as a Drop in the public feed', () => {
    it('keeps one out of the feed everybody sees', async () => {
      const brand = await arrangeBrand();
      const strap = await arrangeWatch(brand.id, 'Rallye Leather Strap', WatchKind.accessory);
      const watch = await arrangeWatch(brand.id, 'Superman Bronze', WatchKind.watch);
      await arrangeDrop(brand.id, strap.id, 'Rallye Leather Strap');
      await arrangeDrop(brand.id, watch.id, 'Superman Bronze');

      const feed = await catalog.listPublishedDrops(200);

      const titles = feed.drops.map((d) => d.title);
      expect(titles).toContain('Superman Bronze');
      expect(titles).not.toContain('Rallye Leather Strap');
    });

    it('keeps one off the brand page', async () => {
      const brand = await arrangeBrand();
      const strap = await arrangeWatch(brand.id, 'Mesh Bracelet', WatchKind.accessory);
      const watch = await arrangeWatch(brand.id, 'Skin Diver', WatchKind.watch);
      await arrangeDrop(brand.id, strap.id, 'Mesh Bracelet');
      await arrangeDrop(brand.id, watch.id, 'Skin Diver');

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.drops.map((d) => d.title)).toEqual(['Skin Diver']);
    });

    it('does not count one in the brand directory', async () => {
      // The card says "3 drops tracked". Counting straps makes it a lie.
      const brand = await arrangeBrand();
      const strap = await arrangeWatch(brand.id, 'Canvas Strap', WatchKind.accessory);
      const watch = await arrangeWatch(brand.id, 'Meridian GMT', WatchKind.watch);
      await arrangeDrop(brand.id, strap.id, 'Canvas Strap');
      await arrangeDrop(brand.id, watch.id, 'Meridian GMT');

      const { brands } = await catalog.listBrands(200);
      const mine = brands.find((b) => b.slug === brand.slug);

      expect(mine?._count.drops).toBe(1);
    });

    it('404s the accessory Drop even by direct id', async () => {
      // The feed hiding it is not enough if the URL still serves it.
      const brand = await arrangeBrand();
      const strap = await arrangeWatch(brand.id, 'Parachute Strap', WatchKind.accessory);
      const drop = await arrangeDrop(brand.id, strap.id, 'Parachute Strap');

      await expect(catalog.getPublishedDrop(drop.id)).rejects.toThrow(/not found/i);
    });

    it('still serves a Drop that belongs to no Watch at all', async () => {
      // Anything read out of a publication's RSS has a null watch_id. Excluding
      // accessories must not quietly exclude the whole of Tier 1 with them.
      const brand = await arrangeBrand();
      await prisma.drop.create({
        data: {
          brandId: brand.id,
          title: 'Read about it in Hodinkee',
          type: DropType.kickstarter_launch,
          moderationStatus: ModerationStatus.approved,
          publishedAt: new Date(),
        },
      });

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.drops.map((d) => d.title)).toEqual(['Read about it in Hodinkee']);
    });
  });

  describe('nothing about an accessory reaches a Channel or an inbox', () => {
    // The half that cannot be taken back. #38 stopped the watcher *creating*
    // these Drops; the ones it created before that are still in the database,
    // and every path that sends has to leave them alone.

    it('does not offer one to a Channel that has never seen it', async () => {
      // The live hazard: candidates are chosen per channel, so wiring up a new
      // locale or a partner group would post every historic strap.
      const brand = await arrangeBrand();
      const strap = await arrangeWatch(brand.id, 'Leather Strap', WatchKind.accessory);
      const watch = await arrangeWatch(brand.id, 'Superman Bronze', WatchKind.watch);
      await arrangeDrop(brand.id, strap.id, 'Leather Strap');
      await arrangeDrop(brand.id, watch.id, 'Superman Bronze');

      const offered = await alerts.backfill({ limit: 200 });

      const titles = offered.candidates.map((c) => c.title);
      expect(titles).toContain('Superman Bronze');
      expect(titles).not.toContain('Leather Strap');
    });

    it('refuses to broadcast one handed to it directly', async () => {
      // The moderation queue can still hold an accessory Drop from before #38.
      // Approving it calls straight through to here.
      const brand = await arrangeBrand();
      const strap = await arrangeWatch(brand.id, 'Boucle SERICA', WatchKind.accessory);
      const drop = await arrangeDrop(brand.id, strap.id, 'Boucle SERICA');

      const result = await alerts.broadcastDrop(drop.id);

      expect(result.sentCount).toBe(0);
      expect(telegram.sent).toHaveLength(0);
    });

    it('still broadcasts a watch', async () => {
      // The guard must not be a blanket off switch.
      const brand = await arrangeBrand();
      const watch = await arrangeWatch(brand.id, 'Meridian GMT', WatchKind.watch);
      const drop = await arrangeDrop(brand.id, watch.id, 'Meridian GMT');

      const result = await alerts.broadcastDrop(drop.id);

      expect(result.sentCount).toBe(2);
      expect(telegram.sent).toHaveLength(2);
    });

    it('keeps one out of the weekly email', async () => {
      const brand = await arrangeBrand();
      const strap = await arrangeWatch(brand.id, 'Canvas Strap', WatchKind.accessory);
      const watch = await arrangeWatch(brand.id, 'Skin Diver', WatchKind.watch);
      await arrangeDrop(brand.id, strap.id, 'Canvas Strap');
      await arrangeDrop(brand.id, watch.id, 'Skin Diver');

      const html = await digest.preview();

      expect(html).toContain('Skin Diver');
      expect(html).not.toContain('Canvas Strap');
    });
  });

  describe('somewhere a reader can reach them', () => {
    it('lists what else the brand sells, with a price and a link', async () => {
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Superman Bronze', WatchKind.watch);
      await arrangeWatch(brand.id, 'Rallye Leather Strap', WatchKind.accessory, [
        { price: 120 },
        { price: 90 },
      ]);

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.accessories).toHaveLength(1);
      const [strap] = detail.accessories;
      expect(strap.name).toBe('Rallye Leather Strap');
      expect(Number(strap.priceLow)).toBe(90); // cheapest of the two
      expect(strap.currency).toBe('EUR');
      expect(strap.variantCount).toBe(2);
      expect(strap.imageUrl).toBe('https://cdn.example/strap.jpg');
      // The slug is what makes it reachable — it is a page that already exists.
      expect(strap.slug).toBeTruthy();
    });

    it('does not mix watches in among them', async () => {
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Superman Bronze', WatchKind.watch);
      await arrangeWatch(brand.id, 'Leather Strap', WatchKind.accessory);

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.accessories.map((a) => a.name)).toEqual(['Leather Strap']);
    });

    it('leads with the ones a reader can actually buy', async () => {
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Sold Out Strap', WatchKind.accessory, [
        { price: 50, available: false },
      ]);
      await arrangeWatch(brand.id, 'In Stock Strap', WatchKind.accessory, [
        { price: 200, available: true },
      ]);

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.accessories.map((a) => a.name)).toEqual([
        'In Stock Strap',
        'Sold Out Strap',
      ]);
      expect(detail.accessories[0].available).toBe(true);
      expect(detail.accessories[1].available).toBe(false);
    });

    it('gives a brand with no accessories an empty list, not a missing one', async () => {
      // The page must render normally rather than guarding against undefined.
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Superman Bronze', WatchKind.watch);

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.accessories).toEqual([]);
    });

    it('includes accessories recorded long before any of this', async () => {
      // Nothing about the display depends on a fresh poll: the rows have been
      // there since the catalogue was first indexed.
      const brand = await arrangeBrand();
      const old = await arrangeWatch(brand.id, 'Vintage Leather Strap', WatchKind.accessory);
      await prisma.watch.update({
        where: { id: old.id },
        data: { firstSeenAt: new Date('2026-07-01T00:00:00.000Z') },
      });

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.accessories.map((a) => a.name)).toContain('Vintage Leather Strap');
    });

    it('shows one with no price and no photo without inventing either', async () => {
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Spring Bar Tool', WatchKind.accessory, [
        { price: null, image: null },
      ]);

      const detail = await catalog.getBrandBySlug(brand.slug);

      const [tool] = detail.accessories;
      expect(tool.priceLow).toBeNull();
      expect(tool.imageUrl).toBeNull();
    });
  });
});
