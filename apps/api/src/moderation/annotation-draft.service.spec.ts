/**
 * Drafting the facts behind an Annotation — and never the Annotation.
 *
 * The Annotation is the differentiator (`CONTEXT.md` §2) and the only part
 * worth reading is the judgement, which a model is bad at. So the split: a
 * model assembles facts, a person writes the sentence, and nothing here can
 * produce one (#30, ADR-0009).
 *
 * Most of these tests are about what it refuses to do — write prose, invent a
 * confident empty draft, repeat somebody's copy back, or touch the Brand.
 */
import { BrandStatus, DraftStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AnnotationDraftService } from './annotation-draft.service';
import { AnthropicService } from '../extraction/anthropic.service';
import { BrandFactsDraft } from './annotation-draft.types';
import { TokenCount } from '../extraction/pricing';
import { RobotsService } from '../site-watch/robots.service';
import { SiteFetcher } from '../site-watch/site-fetcher';

const DEFAULT_FACTS: BrandFactsDraft = {
  movement_supplier: 'Sellita',
  in_house_movement: false,
  known_for: ['bronze divers', 'field watches'],
  signature_watch: 'Aquascaphe',
  assembled_in: 'France',
};

/** Answers with whatever the test says the model returned, and counts calls. */
class StubAnthropic {
  enabled = true;
  facts: BrandFactsDraft | null = { ...DEFAULT_FACTS };
  usage: TokenCount = { inputTokens: 900, outputTokens: 120 };
  model = 'claude-haiku-4-5';
  prompts: string[] = [];
  countedPrompts: string[] = [];
  throwWith: Error | null = null;

  isEnabled() {
    return this.enabled;
  }
  draftModel() {
    return this.model;
  }
  async countDraftTokens(prompt: string) {
    this.countedPrompts.push(prompt);
    return 900;
  }
  async draftBrandFacts(prompt: string) {
    this.prompts.push(prompt);
    if (this.throwWith) throw this.throwWith;
    return { facts: this.facts, usage: this.usage, model: this.model };
  }
}

/** Serves the brand's own page, or whatever failure the test is about. */
class StubFetcher {
  status = 200;
  body =
    '<html><body><h1>Baltic</h1>' +
    '<p>Vintage-inspired mechanical watches, assembled in Morteau.</p>' +
    '<script>ignored()</script></body></html>';
  throwWith: Error | null = null;
  urls: string[] = [];

  async fetch(url: string) {
    this.urls.push(url);
    if (this.throwWith) throw this.throwWith;
    return { status: this.status, body: this.body };
  }
}

class StubRobots {
  allowed = true;
  async allows() {
    return this.allowed;
  }
}

describe('AnnotationDraftService', () => {
  let prisma: PrismaService;
  let anthropic: StubAnthropic;
  let fetcher: StubFetcher;
  let robots: StubRobots;
  let drafts: AnnotationDraftService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    anthropic = new StubAnthropic();
    fetcher = new StubFetcher();
    robots = new StubRobots();
    drafts = new AnnotationDraftService(
      prisma,
      anthropic as unknown as AnthropicService,
      fetcher as unknown as SiteFetcher,
      robots as unknown as RobotsService,
    );
  });

  beforeEach(() => {
    anthropic.prompts = [];
    anthropic.countedPrompts = [];
    anthropic.throwWith = null;
    anthropic.enabled = true;
    anthropic.facts = { ...DEFAULT_FACTS };
    fetcher.urls = [];
    fetcher.status = 200;
    fetcher.throwWith = null;
    fetcher.body =
      '<html><body><h1>Baltic</h1>' +
      '<p>Vintage-inspired mechanical watches, assembled in Morteau.</p>' +
      '<script>ignored()</script></body></html>';
    robots.allowed = true;
  });

  afterAll(async () => {
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function arrangeBrand(
    over: {
      annotation?: string;
      status?: BrandStatus;
      country?: string;
      website?: string | null;
    } = {},
  ) {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: {
        name: `Baltic ${tag}`,
        slug: `baltic-${tag}`,
        website: over.website === undefined ? 'https://baltic.example' : over.website,
        country: over.country ?? 'France',
        foundedYearEst: 2017,
        annotation: over.annotation,
        status: over.status ?? BrandStatus.listed,
      },
    });
    brandIds.push(brand.id);
    return brand;
  }

  const draftFor = (brandId: string) =>
    prisma.brandAnnotationDraft.findUnique({ where: { brandId } });

  /** The prompt this run built for one particular Brand. */
  const promptAbout = (name: string) =>
    anthropic.prompts.find((p) => p.includes(name));

  describe('what it drafts', () => {
    it('stores the facts a writer needs', async () => {
      const brand = await arrangeBrand();

      const run = await drafts.draft({ limit: 5, confirm: true });

      expect(run.drafted).toBeGreaterThanOrEqual(1);
      const draft = await draftFor(brand.id);
      const facts = draft?.facts as Record<string, unknown>;
      expect(facts.movementSupplier).toBe('Sellita');
      expect(facts.knownFor).toEqual(['bronze divers', 'field watches']);
      expect(draft?.status).toBe(DraftStatus.usable);
    });

    it('carries what we already knew, rather than paying to be told again', async () => {
      // Country, founding year and the price band come from our own database.
      // Asking a model to re-derive them spends money to invite disagreement.
      const brand = await arrangeBrand({ country: 'Sweden' });

      await drafts.draft({ limit: 5, confirm: true });

      const facts = (await draftFor(brand.id))?.facts as Record<string, unknown>;
      expect(facts.country).toBe('Sweden');
      expect(facts.foundedYearEst).toBe(2017);
    });

    it('records what the draft cost, in tokens and in money', async () => {
      const brand = await arrangeBrand();

      const run = await drafts.draft({ limit: 5, confirm: true });

      const draft = await draftFor(brand.id);
      expect(draft?.inputTokens).toBe(900);
      expect(draft?.outputTokens).toBe(120);
      expect(run.usage.inputTokens).toBeGreaterThanOrEqual(900);
      // Haiku: 900/1e6 * $1 + 120/1e6 * $5, times however many brands ran.
      const brands = run.brands.length;
      expect(run.costUsd).toBeCloseTo((0.0009 + 0.0006) * brands, 6);
    });

    it('replaces a Brand’s previous draft rather than stacking them up', async () => {
      const brand = await arrangeBrand();

      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });
      anthropic.facts = { ...DEFAULT_FACTS, movement_supplier: 'Miyota' };
      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });

      const all = await prisma.brandAnnotationDraft.findMany({
        where: { brandId: brand.id },
      });
      expect(all).toHaveLength(1);
      expect((all[0].facts as Record<string, unknown>).movementSupplier).toBe(
        'Miyota',
      );
    });
  });

  describe('what it shows the model', () => {
    it('shows the brand’s own site rather than asking it to remember', async () => {
      // The failure this prevents: a model asked about an obscure microbrand
      // from memory invents a movement supplier with total confidence.
      const brand = await arrangeBrand();

      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });

      expect(fetcher.urls).toContain('https://baltic.example');
      expect(promptAbout(brand.name)).toContain('assembled in Morteau');
    });

    it('shows the Watches and Drops we already track', async () => {
      const brand = await arrangeBrand();
      await prisma.watch.create({
        data: {
          brandId: brand.id,
          name: 'Aquascaphe Bronze',
          slug: `aq-${brand.slug}`,
          key: `aq-${brand.slug}`,
        },
      });

      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });

      expect(promptAbout(brand.name)).toContain('Aquascaphe Bronze');
    });

    it('does not read a site robots.txt disallows', async () => {
      // Drafting is not an excuse to stop reading these sites politely.
      robots.allowed = false;
      const brand = await arrangeBrand();

      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });

      expect(fetcher.urls).toHaveLength(0);
      const draft = await draftFor(brand.id);
      expect(draft?.note).toMatch(/robots\.txt/i);
    });

    it('tells the writer when the site could not be read', async () => {
      // A good-looking draft assembled from nothing is the dangerous case: the
      // writer should know the site was unreachable before trusting it.
      fetcher.throwWith = new Error('ECONNREFUSED');
      const brand = await arrangeBrand();

      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });

      const draft = await draftFor(brand.id);
      expect(draft?.status).toBe(DraftStatus.usable);
      expect(draft?.note).toMatch(/ECONNREFUSED/);
    });

    it('drafts a Brand we hold no website for, and says so', async () => {
      const brand = await arrangeBrand({ website: null });

      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });

      expect(fetcher.urls).toHaveLength(0);
      expect((await draftFor(brand.id))?.note).toMatch(/no website/i);
    });
  });

  describe('the judgement, which it never writes', () => {
    it('leaves the Brand’s Annotation untouched', async () => {
      const brand = await arrangeBrand();

      await drafts.draft({ limit: 5, confirm: true });

      const after = await prisma.brand.findUnique({ where: { id: brand.id } });
      expect(after?.annotation).toBeNull();
      expect(after?.annotationApprovedAt).toBeNull();
    });

    it('never moves a Brand to Curated', async () => {
      // Curated means a human approved the Annotation. Nothing automatic may
      // set it, which is what keeps the state meaningful (#22, ADR-0004).
      const brand = await arrangeBrand();

      await drafts.draft({ limit: 5, confirm: true });

      const after = await prisma.brand.findUnique({ where: { id: brand.id } });
      expect(after?.status).toBe(BrandStatus.listed);
    });

    it('leaves a Brand exactly as it was when its draft is thrown away', async () => {
      // The reason drafts live in their own table: rejecting one is a delete,
      // and there is no half-annotated state to clean up.
      const brand = await arrangeBrand();
      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });

      await drafts.reject(brand.slug);

      expect(await draftFor(brand.id)).toBeNull();
      const after = await prisma.brand.findUnique({ where: { id: brand.id } });
      expect(after?.annotation).toBeNull();
      expect(after?.status).toBe(BrandStatus.listed);
      expect(after).not.toBeNull();
    });
  });

  describe('what it refuses to store', () => {
    it('fails visibly when the model knows nothing, rather than drafting an empty brief', async () => {
      anthropic.facts = {
        movement_supplier: null,
        in_house_movement: null,
        known_for: [],
        signature_watch: null,
        assembled_in: null,
      };
      const brand = await arrangeBrand();

      const run = await drafts.draft({ limit: 5, confirm: true });

      const draft = await draftFor(brand.id);
      expect(draft?.status).toBe(DraftStatus.empty);
      expect(draft?.note).toMatch(/not enough|nothing/i);
      expect(run.empty).toBeGreaterThanOrEqual(1);
    });

    it('drops a "fact" copied out of the brand’s own page', async () => {
      // The guard that matters once the site is fetched (CONTEXT.md §6): a
      // tagline is short, so a length cap alone waves it straight through.
      fetcher.body =
        '<html><body><p>Vintage-inspired mechanical watches for every day.</p></body></html>';
      anthropic.facts = {
        ...DEFAULT_FACTS,
        signature_watch: 'Vintage-inspired mechanical watches',
      };
      const brand = await arrangeBrand();

      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });

      const facts = (await draftFor(brand.id))?.facts as Record<string, unknown>;
      expect(facts.signatureWatch).toBeNull();
      // The facts it did not copy still stand.
      expect(facts.movementSupplier).toBe('Sellita');
    });

    it('drops a "fact" that arrived as a sentence', async () => {
      // The whole point of the split: a tag is "bronze divers", not a clause.
      anthropic.facts = {
        ...DEFAULT_FACTS,
        known_for: [
          'bronze divers',
          'Baltic is a French microbrand founded in 2017 whose vintage-inspired designs have won a devoted following.',
        ],
      };
      const brand = await arrangeBrand();

      await drafts.draft({ limit: 5, confirm: true });

      const facts = (await draftFor(brand.id))?.facts as Record<string, unknown>;
      expect(facts.knownFor).toEqual(['bronze divers']);
    });

    it('says so when too little survived to brief anyone', async () => {
      anthropic.facts = {
        movement_supplier: null,
        in_house_movement: null,
        known_for: ['bronze divers'],
        signature_watch: null,
        assembled_in: null,
      };
      const brand = await arrangeBrand();

      await drafts.draft({ limit: 5, confirm: true });

      const draft = await draftFor(brand.id);
      expect(draft?.status).toBe(DraftStatus.empty);
      expect(draft?.note).toMatch(/1 usable fact/i);
    });

    it('counts each tag, because four of them is a briefing', async () => {
      // The first production run threw this away: YEMA came back with
      // "diving, motorsports, military, aviation" — four accurate tags, which
      // is exactly what a writer opens the draft for — and the whole list
      // counted as one fact, so it was recorded as having nothing useful.
      anthropic.facts = {
        movement_supplier: null,
        in_house_movement: null,
        known_for: [
          'diving watches',
          'motorsports watches',
          'military watches',
          'aviation watches',
        ],
        signature_watch: null,
        assembled_in: null,
      };
      const brand = await arrangeBrand();

      await drafts.draft({ limit: 5, confirm: true });

      const draft = await draftFor(brand.id);
      expect(draft?.status).toBe(DraftStatus.usable);
    });

    it('keeps at most four tags, however many arrive', async () => {
      anthropic.facts = {
        ...DEFAULT_FACTS,
        known_for: ['a', 'b', 'c', 'd', 'e', 'f'],
      };
      const brand = await arrangeBrand();

      await drafts.draft({ limit: 5, confirm: true });

      const facts = (await draftFor(brand.id))?.facts as Record<string, unknown>;
      expect((facts.knownFor as string[]).length).toBe(4);
    });
  });

  describe('who it drafts for', () => {
    it('leaves a Brand that already has an Annotation alone', async () => {
      // 37 Brands are unannotated; re-drafting the ones a person has already
      // written about is money spent to produce nothing.
      const brand = await arrangeBrand({ annotation: 'Already written.' });

      await drafts.draft({ limit: 20, confirm: true });

      expect(await draftFor(brand.id)).toBeNull();
    });

    it('leaves a Brand that already has a draft alone', async () => {
      const brand = await arrangeBrand();
      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });
      anthropic.prompts = [];

      await drafts.draft({ limit: 20, confirm: true });

      expect(promptAbout(brand.name)).toBeUndefined();
    });

    it('leaves a Brand we already answered "nothing" for alone', async () => {
      // An empty answer is an answer. Asking again spends money to be told the
      // same thing.
      anthropic.facts = {
        movement_supplier: null,
        in_house_movement: null,
        known_for: [],
        signature_watch: null,
        assembled_in: null,
      };
      const brand = await arrangeBrand();
      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });
      anthropic.facts = { ...DEFAULT_FACTS };
      anthropic.prompts = [];

      await drafts.draft({ limit: 20, confirm: true });

      expect(promptAbout(brand.name)).toBeUndefined();
    });

    it('asks again about an empty Brand when told the asking has changed', async () => {
      // Not a way to hope for a better answer to the same question: the escape
      // hatch for when the threshold or the evidence has changed underneath it.
      anthropic.facts = {
        movement_supplier: null,
        in_house_movement: null,
        known_for: [],
        signature_watch: null,
        assembled_in: null,
      };
      const brand = await arrangeBrand();
      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });
      anthropic.facts = { ...DEFAULT_FACTS };
      anthropic.prompts = [];

      await drafts.draft({ limit: 20, confirm: true, retryEmpty: true });

      expect(promptAbout(brand.name)).toBeDefined();
      expect((await draftFor(brand.id))?.status).toBe(DraftStatus.usable);
    });

    it('still leaves a good draft alone when retrying the empty ones', async () => {
      const brand = await arrangeBrand();
      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });
      anthropic.prompts = [];

      await drafts.draft({ limit: 20, confirm: true, retryEmpty: true });

      expect(promptAbout(brand.name)).toBeUndefined();
    });

    it('asks again about a Brand it could not ask about', async () => {
      // A transient API error is not an answer. Treating it as one would drop
      // a Brand from the catalogue's coverage until somebody named its slug.
      const brand = await arrangeBrand();
      anthropic.throwWith = new Error('model unavailable');
      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });
      anthropic.throwWith = null;
      anthropic.prompts = [];

      await drafts.draft({ limit: 20, confirm: true });

      expect(promptAbout(brand.name)).toBeDefined();
      expect((await draftFor(brand.id))?.status).toBe(DraftStatus.usable);
    });

    it('drafts a named Brand even when it already has one', async () => {
      // The re-draft path: an operator who did not like what came back.
      const brand = await arrangeBrand();
      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });
      anthropic.prompts = [];

      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });

      expect(promptAbout(brand.name)).toBeDefined();
    });
  });

  describe('before it spends anything', () => {
    it('estimates the run without calling the model', async () => {
      await arrangeBrand();

      const run = await drafts.draft({ limit: 5 });

      expect(run.confirmed).toBe(false);
      expect(run.drafted).toBe(0);
      expect(anthropic.prompts).toHaveLength(0);
      // It still asked the tokeniser what the prompt weighs — that is the
      // estimate, and it is free.
      expect(anthropic.countedPrompts.length).toBeGreaterThanOrEqual(1);
      expect(run.estimate?.worstCaseUsd).toBeGreaterThan(0);
    });

    it('bounds the estimate by the output ceiling, not by hope', async () => {
      await arrangeBrand();

      const run = await drafts.draft({ limit: 5 });

      // 900 in + the 512-token cap out, per brand, at Haiku rates.
      const perBrand = (900 / 1e6) * 1 + (512 / 1e6) * 5;
      expect(run.estimate?.worstCaseUsd).toBeCloseTo(
        perBrand * run.estimate!.brands,
        6,
      );
    });

    it('estimates the whole catalogue, but only ever spends on a hundred', async () => {
      // The criterion is budgeting a 300-Brand catalogue. Clamping the free
      // estimate would leave the operator extrapolating by hand — which is the
      // arithmetic this exists to do. Clamping the spend is the safety rail.
      const tag = randomUUID().slice(0, 8);
      await prisma.brand.createMany({
        data: Array.from({ length: 101 }, (_, i) => ({
          name: `Bulk ${tag} ${i}`,
          slug: `bulk-${tag}-${i}`,
          status: BrandStatus.listed,
        })),
      });
      try {
        const dry = await drafts.draft({ limit: 500 });
        expect(dry.estimate!.brands).toBeGreaterThan(100);

        const spend = await drafts.draft({ limit: 500, confirm: true });
        expect(spend.candidates).toBe(100);
        expect(anthropic.prompts).toHaveLength(100);
      } finally {
        await prisma.brand.deleteMany({ where: { slug: { startsWith: `bulk-${tag}-` } } });
      }
    });
  });

  describe('when it cannot run at all', () => {
    it('refuses rather than reporting a run of zero brands', async () => {
      anthropic.enabled = false;

      await expect(drafts.draft({ limit: 5, confirm: true })).rejects.toThrow(
        /not configured/i,
      );
    });

    it('records the failure against the Brand and keeps going', async () => {
      const brand = await arrangeBrand();
      anthropic.throwWith = new Error('model unavailable');

      const run = await drafts.draft({ limit: 5, confirm: true });

      expect(run.failed).toBeGreaterThanOrEqual(1);
      const draft = await draftFor(brand.id);
      expect(draft?.status).toBe(DraftStatus.failed);
      expect(draft?.note).toMatch(/model unavailable/i);
    });
  });
});
