/**
 * Whether the brand enrichment pass converges.
 *
 * The real service and a real database; only the model is replaced. The point of
 * these tests is not that a brand gets filled in — that already worked — but
 * that running the pass repeatedly stops asking about brands it cannot resolve
 * and reaches the newly discovered ones instead. Without that, automating it is
 * a bill that grows hourly and fixes nothing.
 */
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DropWriterService } from '../drops/drop-writer.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnthropicService } from './anthropic.service';
import { ExtractionService } from './extraction.service';

/** Answers about brands the test has opinions on, and records who was asked. */
class ScriptedModel {
  asked: string[] = [];
  answers = new Map<
    string,
    { country: string | null; website: string | null; founded_year: number | null }
  >();
  enabled = true;

  isEnabled(): boolean {
    return this.enabled;
  }

  async enrichBrand(brandName: string) {
    this.asked.push(brandName);
    return this.answers.get(brandName) ?? null;
  }
}

describe('brand enrichment', () => {
  let prisma: PrismaService;
  let model: ScriptedModel;
  let extraction: ExtractionService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  beforeEach(() => {
    model = new ScriptedModel();
    extraction = new ExtractionService(
      prisma,
      model as unknown as AnthropicService,
      new ConfigService({}),
      new DropWriterService(prisma),
    );
  });

  afterAll(async () => {
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  /** A brand as extraction leaves it: a name, and whatever the article said. */
  async function arrangeBrand(
    over: {
      website?: string | null;
      country?: string | null;
      foundedYearEst?: number | null;
      enrichmentAttempts?: number;
    } = {},
  ) {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: {
        name: `Nomos ${tag}`,
        slug: `nomos-${tag}`,
        website: over.website ?? null,
        country: over.country ?? null,
        foundedYearEst: over.foundedYearEst ?? null,
        enrichmentAttempts: over.enrichmentAttempts ?? 0,
      },
    });
    brandIds.push(brand.id);
    return brand;
  }

  const reload = (id: string) =>
    prisma.brand.findUniqueOrThrow({ where: { id } });

  it('fills in a brand the model knows about', async () => {
    const brand = await arrangeBrand();
    model.answers.set(brand.name, {
      country: 'Germany',
      website: 'https://nomos-glashuette.com',
      founded_year: 1990,
    });

    const result = await extraction.enrichBrands(50);

    expect(result.updated).toBeGreaterThanOrEqual(1);
    const after = await reload(brand.id);
    expect(after.website).toBe('https://nomos-glashuette.com');
    expect(after.country).toBe('Germany');
    expect(after.foundedYearEst).toBe(1990);
  });

  it('records that it asked, whether or not it learned anything', async () => {
    // Counting the ask is what lets the pass give up later.
    const known = await arrangeBrand();
    model.answers.set(known.name, {
      country: 'Germany',
      website: null,
      founded_year: null,
    });
    const unknown = await arrangeBrand();

    await extraction.enrichBrands(50);

    expect((await reload(known.id)).enrichmentAttempts).toBe(1);
    expect((await reload(unknown.id)).enrichmentAttempts).toBe(1);
    expect((await reload(unknown.id)).enrichmentAskedAt).not.toBeNull();
  });

  it('stops asking about a brand it has already failed to resolve', async () => {
    // The brand nobody can answer for. Without a limit this is asked about on
    // every run, forever, at a cost per ask.
    const hopeless = await arrangeBrand();

    for (let run = 0; run < 6; run += 1) await extraction.enrichBrands(50);

    const asks = model.asked.filter((n) => n === hopeless.name).length;
    expect(asks).toBeGreaterThan(0);
    expect(asks).toBeLessThanOrEqual(3);
  });

  it('reaches a newly discovered brand instead of the old unresolvable ones', async () => {
    // The failure this exists to prevent: a queue of long-standing brands that
    // will never be complete, starving the brand that arrived this morning and
    // has no website — the only gap that costs a reader a purchase link.
    const stale: Array<{ name: string }> = [];
    for (let i = 0; i < 5; i += 1) {
      stale.push(await arrangeBrand({ enrichmentAttempts: 3 }));
    }
    const fresh = await arrangeBrand();
    model.answers.set(fresh.name, {
      country: null,
      website: 'https://fresh.example',
      founded_year: null,
    });

    await extraction.enrichBrands(3);

    expect(model.asked).toContain(fresh.name);
    for (const s of stale) expect(model.asked).not.toContain(s.name);
    expect((await reload(fresh.id)).website).toBe('https://fresh.example');
  });

  it('prefers a missing website over a missing founding year', async () => {
    // A missing website means no purchase link anywhere. A missing founding
    // year costs a chip on a brand page. They are not equally urgent.
    const noYear = await arrangeBrand({
      website: 'https://known.example',
      country: 'Germany',
    });
    const noWebsite = await arrangeBrand({ country: 'Germany', foundedYearEst: 1990 });

    await extraction.enrichBrands(1);

    expect(model.asked).toContain(noWebsite.name);
    expect(model.asked).not.toContain(noYear.name);
  });

  it('never overwrites a detail already recorded', async () => {
    const brand = await arrangeBrand({ website: 'https://correct.example' });
    model.answers.set(brand.name, {
      country: 'Germany',
      website: 'https://wrong.example',
      founded_year: null,
    });

    await extraction.enrichBrands(50);

    expect((await reload(brand.id)).website).toBe('https://correct.example');
    expect((await reload(brand.id)).country).toBe('Germany');
  });

  it('honours the cap, so a busy day has a predictable cost', async () => {
    for (let i = 0; i < 6; i += 1) await arrangeBrand();

    await extraction.enrichBrands(2);

    expect(model.asked).toHaveLength(2);
  });

  it('does nothing at all without a model key', async () => {
    const brand = await arrangeBrand();
    model.enabled = false;

    const result = await extraction.enrichBrands(50);

    expect(result.enabled).toBe(false);
    expect(model.asked).toHaveLength(0);
    // No attempt recorded either — configuring a key later must still try.
    expect((await reload(brand.id)).enrichmentAttempts).toBe(0);
  });

  it('reports how much is still incomplete, so a run can be read', async () => {
    await arrangeBrand({ enrichmentAttempts: 3 });

    const result = await extraction.enrichBrands(50);

    expect(result).toHaveProperty('considered');
    expect(result).toHaveProperty('updated');
    expect(result).toHaveProperty('exhausted');
    expect(result.exhausted).toBeGreaterThanOrEqual(1);
  });

  it('keeps going when the model fails on one brand', async () => {
    const brand = await arrangeBrand();
    const other = await arrangeBrand();
    model.answers.set(other.name, {
      country: 'Germany',
      website: null,
      founded_year: null,
    });
    const original = model.enrichBrand.bind(model);
    model.enrichBrand = async (name: string) => {
      if (name === brand.name) throw new Error('model unavailable');
      return original(name);
    };

    const result = await extraction.enrichBrands(50);

    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect((await reload(other.id)).country).toBe('Germany');
    // A brand that errored still counts as asked, or it is retried forever.
    expect((await reload(brand.id)).enrichmentAttempts).toBe(1);
  });
});
