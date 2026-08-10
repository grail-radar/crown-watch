/**
 * Drafting the facts behind an Annotation — and never the Annotation.
 *
 * The Annotation is the differentiator (`CONTEXT.md` §2) and the only part
 * worth reading is the judgement, which a model is bad at. So the split: a
 * model assembles facts, a person writes the sentence, and nothing here can
 * produce one (#30, ADR-0009).
 *
 * Most of these tests are about what it refuses to do — write prose, invent a
 * confident empty draft, or touch the Brand.
 */
import { BrandStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AnnotationDraftService } from './annotation-draft.service';
import { AnthropicService } from './anthropic.service';
import { BrandFactsDraft } from './annotation-draft.types';
import { TokenCount } from './pricing';

/** Answers with whatever the test says the model returned, and counts calls. */
class StubAnthropic {
  enabled = true;
  facts: BrandFactsDraft | null = {
    movement_supplier: 'Sellita',
    in_house_movement: false,
    known_for: ['bronze divers', 'field watches'],
    signature_watch: 'Aquascaphe',
    assembled_in: 'France',
  };
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

describe('AnnotationDraftService', () => {
  let prisma: PrismaService;
  let anthropic: StubAnthropic;
  let drafts: AnnotationDraftService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    anthropic = new StubAnthropic();
    drafts = new AnnotationDraftService(
      prisma,
      anthropic as unknown as AnthropicService,
    );
  });

  beforeEach(() => {
    anthropic.prompts = [];
    anthropic.countedPrompts = [];
    anthropic.throwWith = null;
    anthropic.enabled = true;
    anthropic.facts = {
      movement_supplier: 'Sellita',
      in_house_movement: false,
      known_for: ['bronze divers', 'field watches'],
      signature_watch: 'Aquascaphe',
      assembled_in: 'France',
    };
  });

  afterAll(async () => {
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function arrangeBrand(
    over: { annotation?: string; status?: BrandStatus; country?: string } = {},
  ) {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: {
        name: `Baltic ${tag}`,
        slug: `baltic-${tag}`,
        website: 'https://baltic.example',
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

  describe('what it drafts', () => {
    it('stores the facts a writer needs', async () => {
      const brand = await arrangeBrand();

      const run = await drafts.draft({ limit: 5, confirm: true });

      expect(run.drafted).toBeGreaterThanOrEqual(1);
      const draft = await draftFor(brand.id);
      const facts = draft?.facts as Record<string, unknown>;
      expect(facts.movementSupplier).toBe('Sellita');
      expect(facts.knownFor).toEqual(['bronze divers', 'field watches']);
      expect(draft?.sufficient).toBe(true);
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
      // Haiku: 900/1e6 * $1 + 120/1e6 * $5.
      expect(run.costUsd).toBeCloseTo(0.0009 + 0.0006, 6);
    });

    it('replaces a Brand’s previous draft rather than stacking them up', async () => {
      const brand = await arrangeBrand();

      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });
      anthropic.facts = { ...anthropic.facts!, movement_supplier: 'Miyota' };
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
      expect(draft?.sufficient).toBe(false);
      expect(draft?.note).toMatch(/nothing/i);
      expect(run.insufficient).toBeGreaterThanOrEqual(1);
    });

    it('drops a "fact" that arrived as a sentence', async () => {
      // The copyright rule (CONTEXT.md §6) and the whole point of the split: a
      // tag is "bronze divers", not a clause lifted from the brand's own copy.
      anthropic.facts = {
        ...anthropic.facts!,
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

    it('says so when everything it was handed read like prose', async () => {
      anthropic.facts = {
        movement_supplier: null,
        in_house_movement: null,
        known_for: [
          'Baltic is a French microbrand whose vintage-inspired designs have won a devoted following among collectors.',
        ],
        signature_watch: null,
        assembled_in: null,
      };
      const brand = await arrangeBrand();

      await drafts.draft({ limit: 5, confirm: true });

      const draft = await draftFor(brand.id);
      expect(draft?.sufficient).toBe(false);
    });

    it('keeps at most four tags, however many arrive', async () => {
      anthropic.facts = {
        ...anthropic.facts!,
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

      expect(anthropic.prompts.some((p) => p.includes(brand.name))).toBe(false);
    });

    it('drafts a named Brand even when it already has one', async () => {
      // The re-draft path: an operator who did not like what came back.
      const brand = await arrangeBrand();
      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });
      anthropic.prompts = [];

      await drafts.draft({ limit: 5, confirm: true, brandSlugs: [brand.slug] });

      expect(anthropic.prompts.some((p) => p.includes(brand.name))).toBe(true);
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
      expect(draft?.sufficient).toBe(false);
      expect(draft?.note).toMatch(/model unavailable/i);
    });
  });
});
