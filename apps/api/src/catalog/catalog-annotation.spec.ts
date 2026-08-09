/**
 * What the website is told about a Brand's Annotation.
 *
 * The guarantee is enforced here rather than asked of the page: a Brand that
 * nobody has curated does not *receive* an Annotation, so no renderer can show
 * one by mistake. That matters because the value of a Curated badge is entirely
 * that a person stood behind the sentence (`CONTEXT.md` §2, ADR-0004).
 */
import { BrandStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from './catalog.service';

describe('CatalogService — annotations', () => {
  let prisma: PrismaService;
  let catalog: CatalogService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    catalog = new CatalogService(prisma);
  });

  afterAll(async () => {
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function arrangeBrand(over: {
    status?: BrandStatus;
    annotation?: string | null;
  } = {}) {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: {
        name: `Brand ${tag}`,
        slug: `brand-${tag}`,
        status: over.status ?? BrandStatus.listed,
        annotation: over.annotation ?? null,
        annotationApprovedAt:
          over.status === BrandStatus.curated ? new Date() : null,
      },
    });
    brandIds.push(brand.id);
    return brand;
  }

  it('serves a Curated Brand its Annotation', async () => {
    const brand = await arrangeBrand({
      status: BrandStatus.curated,
      annotation: 'Superb finishing, and a two-year wait nobody warns you about.',
    });

    const detail = await catalog.getBrandBySlug(brand.slug);

    expect(detail.status).toBe(BrandStatus.curated);
    expect(detail.annotation).toBe(
      'Superb finishing, and a two-year wait nobody warns you about.',
    );
    expect(detail.annotationApprovedAt).not.toBeNull();
  });

  it('serves an unflattering one exactly as written', async () => {
    const blunt = 'The movement is a $30 Seagull in a $900 case.';
    const brand = await arrangeBrand({
      status: BrandStatus.curated,
      annotation: blunt,
    });

    expect((await catalog.getBrandBySlug(brand.slug)).annotation).toBe(blunt);
  });

  it('tells the website nothing about a Listed Brand', async () => {
    const brand = await arrangeBrand();

    const detail = await catalog.getBrandBySlug(brand.slug);

    expect(detail.status).toBe(BrandStatus.listed);
    expect(detail.annotation).toBeNull();
  });

  it('withholds a draft sitting on a Listed Brand', async () => {
    // The case #30 will create: a sentence written but not approved. It must
    // not leak, or `curated` stops meaning a person read it.
    const brand = await arrangeBrand({
      status: BrandStatus.listed,
      annotation: 'Draft nobody has approved.',
    });

    const detail = await catalog.getBrandBySlug(brand.slug);

    expect(detail.annotation).toBeNull();
    expect(detail.annotationApprovedAt).toBeNull();
  });

  it('stops serving one the moment it is withdrawn', async () => {
    const brand = await arrangeBrand({
      status: BrandStatus.curated,
      annotation: 'Worth it.',
    });
    await prisma.brand.update({
      where: { id: brand.id },
      data: { status: BrandStatus.listed },
    });

    expect((await catalog.getBrandBySlug(brand.slug)).annotation).toBeNull();
  });
});
