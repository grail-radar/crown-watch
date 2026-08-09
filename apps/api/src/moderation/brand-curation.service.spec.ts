/**
 * Approving what we say about a Brand.
 *
 * The Annotation is the differentiator (`CONTEXT.md` §2): a much larger
 * competitor tracks ten times as many Brands and cannot say whether any of them
 * is worth your money. That only holds while `curated` means a person read it
 * and agreed — so the interesting assertions here are the ones about what
 * *cannot* happen on its own.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BrandStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BrandCurationService } from './brand-curation.service';

describe('BrandCurationService', () => {
  let prisma: PrismaService;
  let curation: BrandCurationService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    curation = new BrandCurationService(prisma);
  });

  afterAll(async () => {
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function arrangeBrand() {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: { name: `Brand ${tag}`, slug: `brand-${tag}` },
    });
    brandIds.push(brand.id);
    return brand;
  }

  const reload = (slug: string) =>
    prisma.brand.findUniqueOrThrow({ where: { slug } });

  it('starts every Brand Listed, with nothing said about it', async () => {
    const brand = await arrangeBrand();

    const fresh = await reload(brand.slug);
    expect(fresh.status).toBe(BrandStatus.listed);
    expect(fresh.annotation).toBeNull();
    expect(fresh.annotationApprovedAt).toBeNull();
  });

  it('curates a Brand when a person approves a sentence about it', async () => {
    const brand = await arrangeBrand();

    const result = await curation.annotate(
      brand.slug,
      'Beautiful dials, and a delivery record that has disappointed people twice.',
    );

    expect(result.status).toBe(BrandStatus.curated);
    const saved = await reload(brand.slug);
    expect(saved.status).toBe(BrandStatus.curated);
    expect(saved.annotation).toBe(
      'Beautiful dials, and a delivery record that has disappointed people twice.',
    );
    expect(saved.annotationApprovedAt).not.toBeNull();
  });

  it('keeps an unflattering Annotation exactly as written', async () => {
    // No trimming to a house style, no softening, no appended positive. The
    // whole value is that it says the unflattering thing.
    const brand = await arrangeBrand();
    const blunt = 'Overpriced for the movement, and the lume is poor.';

    await curation.annotate(brand.slug, blunt);

    expect((await reload(brand.slug)).annotation).toBe(blunt);
  });

  it('returns a Brand to Listed when approval is withdrawn', async () => {
    const brand = await arrangeBrand();
    await curation.annotate(brand.slug, 'Worth the wait.');

    await curation.withdraw(brand.slug);

    const saved = await reload(brand.slug);
    expect(saved.status).toBe(BrandStatus.listed);
    expect(saved.annotationApprovedAt).toBeNull();
    // The sentence survives as a draft: it is somebody's writing, and the API
    // withholds it the moment the Brand stops being Curated anyway.
    expect(saved.annotation).toBe('Worth the wait.');
  });

  it('refuses to curate on an empty sentence', async () => {
    // Curated with nothing to show would be a badge with no judgement behind
    // it — the exact thing `verified` used to be.
    const brand = await arrangeBrand();

    await expect(curation.annotate(brand.slug, '   ')).rejects.toThrow(
      BadRequestException,
    );
    expect((await reload(brand.slug)).status).toBe(BrandStatus.listed);
  });

  it('refuses a wall of text rather than truncating it', async () => {
    // Cutting somebody's judgement mid-clause is its own misrepresentation,
    // and the page renders this at display size.
    const brand = await arrangeBrand();

    await expect(curation.annotate(brand.slug, 'x'.repeat(401))).rejects.toThrow(
      BadRequestException,
    );
    expect((await reload(brand.slug)).status).toBe(BrandStatus.listed);
  });

  it('trims surrounding whitespace without touching the sentence', async () => {
    const brand = await arrangeBrand();

    await curation.annotate(brand.slug, '  Quietly excellent.  ');

    expect((await reload(brand.slug)).annotation).toBe('Quietly excellent.');
  });

  it('404s a Brand that does not exist', async () => {
    await expect(curation.annotate('nobody', 'A sentence.')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('re-approving records the new time', async () => {
    const brand = await arrangeBrand();
    await curation.annotate(brand.slug, 'First take.');
    const first = (await reload(brand.slug)).annotationApprovedAt;

    await new Promise((r) => setTimeout(r, 5));
    await curation.annotate(brand.slug, 'Revised take.');

    const second = (await reload(brand.slug)).annotationApprovedAt;
    expect(saved(second)).toBeGreaterThan(saved(first));
  });

  const saved = (d: Date | null) => (d ? d.getTime() : 0);
});
