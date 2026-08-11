import { Injectable, Logger } from '@nestjs/common';
import { DraftStatus, Prisma } from '@prisma/client';
import { priceBandFor } from '../catalog/price-band';
import {
  BRAND_FACTS_MAX_TOKENS,
  BrandFactsDraft,
} from './annotation-draft.types';
import { AnthropicService } from '../extraction/anthropic.service';
import { costOf } from '../extraction/pricing';
import { PrismaService } from '../prisma/prisma.service';
import { RobotsService } from '../site-watch/robots.service';
import { SiteFetcher } from '../site-watch/site-fetcher';
import {
  BrandEvidence,
  isLiftedFrom,
  readableText,
} from './brand-evidence';

/**
 * The longest a single fact may be.
 *
 * A second line of defence only. The guard that matters is
 * {@link isLiftedFrom}, which refuses anything that appears verbatim in the
 * material we showed the model — a brand's tagline is usually *short*, so a
 * length cap alone would wave it straight through (`CONTEXT.md` §6).
 */
const MAX_FACT_LENGTH = 60;

/** How many tags are worth a writer's attention. Beyond four it is padding. */
const MAX_TAGS = 4;

/**
 * How many facts make a briefing.
 *
 * One lone tag is not worth a writer opening. Below this the draft is recorded
 * as `empty` — an answer about us, not a fact about the brand.
 */
const MIN_FACTS = 2;

/** The most Brands one run will *spend* on, whatever it is asked for. */
const MAX_BRANDS_PER_RUN = 100;

/** Watches and Drops shown to the model as our own existing coverage. */
const MAX_EVIDENCE_ITEMS = 12;

/** What a draft needs to know about a Brand. Named, per the repo's convention. */
const CANDIDATE_SELECT = {
  id: true,
  name: true,
  slug: true,
  country: true,
  foundedYearEst: true,
  website: true,
  _count: { select: { watches: true, drops: true } },
} satisfies Prisma.BrandSelect;

export type DraftCandidate = Prisma.BrandGetPayload<{
  select: typeof CANDIDATE_SELECT;
}>;

/**
 * The briefing as it is stored: what the model found, plus what we already
 * held. One shape, exported, so the `Json` column has a documented meaning and
 * a new fact cannot be added to half of the code.
 */
export interface BrandDraftFacts {
  name: string;
  website: string | null;
  /** Ours. Never asked of a model — we hold it. */
  country: string | null;
  foundedYearEst: number | null;
  watchCount: number;
  dropCount: number;
  /** Ours, derived from the Brand's own Variants (#28). */
  priceBand: { low: string; high: string; currency: string | null } | null;
  /** Assembled by the model from the material below. */
  movementSupplier: string | null;
  inHouseMovement: boolean | null;
  knownFor: string[];
  signatureWatch: string | null;
  assembledIn: string | null;
  /** What the model was allowed to read, so a writer can judge the facts. */
  sources: { site: string | null; watches: number; drops: number };
}

export interface DraftRequest {
  /** How many Brands to draft. Spending is clamped to {@link MAX_BRANDS_PER_RUN}. */
  limit?: number;
  /** Actually call the model. Omitted or false estimates and spends nothing. */
  confirm?: boolean;
  /**
   * Specific Brands, by slug. Named Brands are drafted even if they already
   * have a draft — the re-draft path for an operator who did not like what came
   * back. Without it, the run picks Brands with no Annotation and no answer.
   */
  brandSlugs?: string[];
  /**
   * Ask again about the Brands that came back with nothing.
   *
   * `empty` normally means "we asked, that was the answer" and is not retried.
   * This is the escape hatch for when the *asking* has changed — a better
   * threshold, a page we can now read — and the old answer no longer stands
   * for what a fresh one would be.
   */
  retryEmpty?: boolean;
}

/** What a run would cost before any of it is spent. */
export interface DraftEstimate {
  brands: number;
  /** Counted by the API's tokeniser, not guessed from characters. */
  inputTokens: number;
  /** The per-Brand output ceiling — a worst case, not a prediction. */
  maxOutputTokensPerBrand: number;
  /** Null when we hold no rate for the model; the tokens above still stand. */
  worstCaseUsd: number | null;
}

export interface DraftRun {
  confirmed: boolean;
  draftedByModel: string;
  /** Brands considered — the queue this run was drawn from. */
  candidates: number;
  drafted: number;
  /** Asked, but with nothing worth handing to a writer. */
  empty: number;
  /** Could not be asked at all. These stay in the queue. */
  failed: number;
  usage: { inputTokens: number; outputTokens: number };
  /** Null when we hold no rate for the model. Tokens above are still exact. */
  costUsd: number | null;
  estimate: DraftEstimate | null;
  brands: Array<{ slug: string; name: string; status: DraftStatus; note?: string }>;
}

/**
 * Assembles the facts behind a Brand's Annotation — and never the Annotation.
 *
 * The Annotation is what this project sells (`CONTEXT.md` §2), and the only
 * part of it worth reading is the judgement. A model is good at gathering facts
 * *that are in front of it* and bad at judgement, so the two are split: this
 * collects the facts, and a person writes the sentence.
 *
 * **Nothing here can write one.** The tool the model answers through has no
 * field for prose, and this service never touches `brands.annotation` or
 * `brands.status`. That is stronger than instructing it not to (ADR-0009), and
 * it is why rejecting a draft is a plain delete with nothing to repair.
 *
 * **The model is shown evidence, not asked to remember.** The brand's own page,
 * the Watches we track, our recent Drops about it, and the price band derived
 * from its Variants. Parametric memory about an obscure microbrand is exactly
 * where a model invents a movement supplier with total confidence.
 *
 * Lives in `moderation/` rather than `extraction/`: this is curation work,
 * alongside the endpoint that publishes an Annotation, and it never touches the
 * raw-event pipeline `extraction/` exists for.
 */
@Injectable()
export class AnnotationDraftService {
  private readonly logger = new Logger(AnnotationDraftService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anthropic: AnthropicService,
    private readonly fetcher: SiteFetcher,
    private readonly robots: RobotsService,
  ) {}

  async draft(request: DraftRequest = {}): Promise<DraftRun> {
    if (!this.anthropic.isEnabled()) {
      // Refused rather than reported as a run of zero: an unconfigured key is a
      // setup problem, and "0 brands drafted, no errors" hides it.
      throw new Error(
        'Anthropic is not configured (ANTHROPIC_API_KEY), so nothing can be drafted.',
      );
    }

    const draftedByModel = this.anthropic.draftModel();
    const confirmed = request.confirm === true;
    // A dry run costs nothing, so it is not clamped: budgeting a 300-Brand
    // catalogue is the criterion, and a cap on the estimate would make the
    // operator extrapolate by hand — which is the arithmetic this exists to do.
    const limit = confirmed
      ? Math.min(Math.max(request.limit ?? 10, 1), MAX_BRANDS_PER_RUN)
      : Math.max(request.limit ?? 10, 1);
    const candidates = await this.candidates(
      limit,
      confirmed,
      request.brandSlugs,
      request.retryEmpty === true,
    );

    const run: DraftRun = {
      confirmed,
      draftedByModel,
      candidates: candidates.length,
      drafted: 0,
      empty: 0,
      failed: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      costUsd: null,
      estimate: null,
      brands: [],
    };
    if (candidates.length === 0) return run;

    run.estimate = await this.estimate(candidates, draftedByModel);
    if (!confirmed) return run;

    for (const brand of candidates) {
      const outcome = await this.draftOne(brand, draftedByModel);
      run.usage.inputTokens += outcome.usage.inputTokens;
      run.usage.outputTokens += outcome.usage.outputTokens;
      if (outcome.status === DraftStatus.failed) run.failed += 1;
      else if (outcome.status === DraftStatus.empty) run.empty += 1;
      else run.drafted += 1;
      run.brands.push({
        slug: brand.slug,
        name: brand.name,
        status: outcome.status,
        ...(outcome.note ? { note: outcome.note } : {}),
      });
    }

    run.costUsd = costOf(draftedByModel, run.usage)?.totalUsd ?? null;
    this.logger.log(
      `Drafted ${run.drafted}, ${run.empty} with nothing useful, ` +
        `${run.failed} could not be asked; ${run.usage.inputTokens} in / ` +
        `${run.usage.outputTokens} out on ${draftedByModel}` +
        (run.costUsd === null ? '' : ` (~$${run.costUsd.toFixed(4)})`),
    );
    return run;
  }

  /**
   * Throw a draft away.
   *
   * The Brand is untouched by construction — drafting never wrote to it — so
   * this needs no undo and cannot leave a half-annotated state behind.
   */
  async reject(slug: string): Promise<boolean> {
    const { count } = await this.prisma.brandAnnotationDraft.deleteMany({
      where: { brand: { slug } },
    });
    return count > 0;
  }

  /**
   * Which Brands are worth drafting.
   *
   * A Brand a person has already written about is skipped — dozens are
   * unannotated, and re-drafting the rest produces nothing. A Brand we already
   * *answered* is skipped too, whether the answer was usable or empty, unless
   * the caller says the asking has changed ({@link DraftRequest.retryEmpty}).
   *
   * A Brand we could not *ask* about stays in the queue: a transient API error
   * is not an answer, and excluding it would quietly drop a Brand from the
   * catalogue's coverage until somebody happened to name its slug.
   */
  private async candidates(
    limit: number,
    confirmed: boolean,
    slugs?: string[],
    retryEmpty = false,
  ) {
    const named = slugs && slugs.length > 0;
    const wanted = named ? slugs!.length : limit;
    const answered: DraftStatus[] = retryEmpty
      ? [DraftStatus.failed, DraftStatus.empty]
      : [DraftStatus.failed];
    return this.prisma.brand.findMany({
      where: named
        ? { slug: { in: slugs } }
        : {
            annotation: null,
            OR: [
              { annotationDraft: { is: null } },
              { annotationDraft: { status: { in: answered } } },
            ],
          },
      orderBy: named ? { name: 'asc' } : { createdAt: 'asc' },
      // Clamped only when spending — and on the named path too, because naming
      // a hundred slugs is still a hundred paid calls and the ceiling should
      // not depend on how the operator phrased the request. A dry run reads the
      // whole queue: it costs nothing, and clamping the *estimate* would leave
      // an operator budgeting a 300-Brand catalogue extrapolating by hand.
      take: confirmed ? Math.min(wanted, MAX_BRANDS_PER_RUN) : wanted,
      select: CANDIDATE_SELECT,
    });
  }

  private async estimate(
    candidates: DraftCandidate[],
    draftedByModel: string,
  ): Promise<DraftEstimate> {
    // One real count against a real prompt, scaled. Counting every brand would
    // spend a request each to refine the figure by a rounding error — but the
    // one prompt is built the same way the paid ones are, evidence included, so
    // the estimate is of the thing that will actually be sent.
    const sample = await this.promptFor(candidates[0]);
    const perBrandInput = await this.anthropic.countDraftTokens(sample.prompt);
    return {
      brands: candidates.length,
      inputTokens: perBrandInput * candidates.length,
      maxOutputTokensPerBrand: BRAND_FACTS_MAX_TOKENS,
      worstCaseUsd:
        costOf(draftedByModel, {
          inputTokens: perBrandInput * candidates.length,
          outputTokens: BRAND_FACTS_MAX_TOKENS * candidates.length,
        })?.totalUsd ?? null,
    };
  }

  private async draftOne(
    brand: DraftCandidate,
    draftedByModel: string,
  ): Promise<{
    usage: { inputTokens: number; outputTokens: number };
    status: DraftStatus;
    note?: string;
  }> {
    const { prompt, evidence } = await this.promptFor(brand);
    let usage = { inputTokens: 0, outputTokens: 0 };
    let raw: BrandFactsDraft | null = null;
    try {
      const answer = await this.anthropic.draftBrandFacts(prompt);
      raw = answer.facts;
      usage = answer.usage;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Draft failed for ${brand.slug}: ${message}`);
      await this.store(brand, draftedByModel, usage, null, evidence, {
        status: DraftStatus.failed,
        note: `Could not ask the model: ${message}`,
      });
      return { usage, status: DraftStatus.failed, note: message };
    }

    const facts = raw ? this.clean(raw, evidence) : null;
    const verdict = this.verdict(facts, evidence);
    await this.store(brand, draftedByModel, usage, facts, evidence, verdict);
    return { usage, status: verdict.status, ...(verdict.note ? { note: verdict.note } : {}) };
  }

  /**
   * Keep the facts; drop anything lifted from the material we showed.
   *
   * Dropping rather than truncating: half a sentence of somebody's copy is
   * still their sentence, and it would read as a fact rather than a liability.
   */
  private clean(facts: BrandFactsDraft, evidence: BrandEvidence) {
    const keep = (value: string | null | undefined): string | null => {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      if (trimmed.length === 0 || trimmed.length > MAX_FACT_LENGTH) return null;
      return isLiftedFrom(trimmed, evidence) ? null : trimmed;
    };

    return {
      movementSupplier: keep(facts.movement_supplier),
      inHouseMovement:
        typeof facts.in_house_movement === 'boolean'
          ? facts.in_house_movement
          : null,
      knownFor: (facts.known_for ?? [])
        .filter((v): v is string => typeof v === 'string')
        .map(keep)
        .filter((v): v is string => v !== null)
        .slice(0, MAX_TAGS),
      signatureWatch: keep(facts.signature_watch),
      assembledIn: keep(facts.assembled_in),
    };
  }

  /**
   * Is this worth a writer's time?
   *
   * A lone tag is not a briefing, and an empty one that *looks* confident is
   * the failure worth guarding: a writer reading "movement supplier: —" takes
   * it for a fact about the brand rather than a fact about us.
   */
  private verdict(
    facts: ReturnType<AnnotationDraftService['clean']> | null,
    evidence: BrandEvidence,
  ): { status: DraftStatus; note: string | null } {
    if (!facts) {
      return {
        status: DraftStatus.empty,
        note: 'The model returned nothing through the tool.',
      };
    }
    // Each tag counts. Counting the whole list as one fact threw away real
    // briefings on the first production run: YEMA came back with "diving,
    // motorsports, military, aviation" — four accurate tags, exactly what a
    // writer opens the draft for — and was recorded as "only 1 usable fact".
    const found =
      [
        facts.movementSupplier,
        facts.inHouseMovement,
        facts.signatureWatch,
        facts.assembledIn,
      ].filter((v) => v !== null && v !== undefined).length +
      facts.knownFor.length;

    if (found >= MIN_FACTS) {
      // Worth carrying even on a good draft: a writer should know the site was
      // unreadable before trusting what came back about it.
      return { status: DraftStatus.usable, note: evidence.siteNote };
    }
    return {
      status: DraftStatus.empty,
      note:
        `Only ${found} usable fact(s) came back — not enough to brief anyone. ` +
        (evidence.siteNote ?? 'The material we could show simply did not say.'),
    };
  }

  /**
   * The briefing, and everything the model was shown.
   *
   * What we already hold — country, founding year, catalogue counts, price band
   * — is written in rather than asked for. Paying a model to re-derive a fact we
   * have buys nothing but the chance of disagreeing with ourselves.
   */
  private async store(
    brand: DraftCandidate,
    draftedByModel: string,
    usage: { inputTokens: number; outputTokens: number },
    facts: ReturnType<AnnotationDraftService['clean']> | null,
    evidence: BrandEvidence,
    verdict: { status: DraftStatus; note: string | null },
  ) {
    const payload: BrandDraftFacts = {
      name: brand.name,
      website: brand.website,
      country: brand.country,
      foundedYearEst: brand.foundedYearEst,
      watchCount: brand._count.watches,
      dropCount: brand._count.drops,
      priceBand: evidence.priceBand,
      movementSupplier: facts?.movementSupplier ?? null,
      inHouseMovement: facts?.inHouseMovement ?? null,
      knownFor: facts?.knownFor ?? [],
      signatureWatch: facts?.signatureWatch ?? null,
      assembledIn: facts?.assembledIn ?? null,
      sources: {
        site: evidence.siteText ? brand.website : null,
        watches: evidence.watchNames.length,
        drops: evidence.dropTitles.length,
      },
    };

    const row = {
      facts: payload as unknown as Prisma.InputJsonValue,
      status: verdict.status,
      note: verdict.note,
      draftedByModel,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
    await this.prisma.brandAnnotationDraft.upsert({
      where: { brandId: brand.id },
      create: { brandId: brand.id, ...row },
      update: row,
    });
  }

  /**
   * Everything the model is shown, and the prompt built from it.
   *
   * The brand's own page is fetched through the same seam and the same
   * robots.txt guard as a Tier 4 poll — this project already reads these sites
   * politely, and drafting is not an excuse to stop.
   */
  private async promptFor(
    brand: DraftCandidate,
  ): Promise<{ prompt: string; evidence: BrandEvidence }> {
    const evidence = await this.gather(brand);
    const lines = [
      `Independent / microbrand watch brand: "${brand.name}".`,
      brand.country ? `Based in: ${brand.country}.` : null,
      brand.foundedYearEst ? `Founded around: ${brand.foundedYearEst}.` : null,
      evidence.watchNames.length > 0
        ? `Watches we already track: ${evidence.watchNames.join('; ')}.`
        : null,
      evidence.dropTitles.length > 0
        ? `Recent releases we covered: ${evidence.dropTitles.join('; ')}.`
        : null,
      evidence.siteText
        ? `\nFrom the brand's own site:\n"""\n${evidence.siteText}\n"""`
        : null,
      '\nRecord only what the material above supports. Use null where it does not.',
    ];
    return { prompt: lines.filter(Boolean).join('\n'), evidence };
  }

  /** Read what we hold and what the brand's own site says. Never throws. */
  private async gather(brand: DraftCandidate): Promise<BrandEvidence> {
    const [watches, drops, priceBand] = await Promise.all([
      this.prisma.watch.findMany({
        where: { brandId: brand.id, kind: 'watch' },
        orderBy: { firstSeenAt: 'desc' },
        take: MAX_EVIDENCE_ITEMS,
        select: { name: true },
      }),
      this.prisma.drop.findMany({
        where: { brandId: brand.id, publishedAt: { not: null } },
        orderBy: { publishedAt: 'desc' },
        take: MAX_EVIDENCE_ITEMS,
        select: { title: true },
      }),
      priceBandFor(this.prisma, brand.id),
    ]);

    const evidence: BrandEvidence = {
      siteText: null,
      siteNote: null,
      watchNames: watches.map((w) => w.name),
      dropTitles: drops.map((d) => d.title),
      priceBand: priceBand
        ? {
            low: priceBand.low.toString(),
            high: priceBand.high.toString(),
            currency: priceBand.currency,
          }
        : null,
    };

    if (!brand.website) {
      evidence.siteNote = 'We hold no website for this Brand, so none was read.';
      return evidence;
    }
    try {
      if (!(await this.robots.allows(brand.website))) {
        evidence.siteNote = `robots.txt disallows ${brand.website}, so it was not read.`;
        return evidence;
      }
      const response = await this.fetcher.fetch(brand.website);
      if (response.status < 200 || response.status >= 300) {
        evidence.siteNote = `The brand's site answered ${response.status}, so nothing was read from it.`;
        return evidence;
      }
      evidence.siteText = readableText(response.body);
      if (!evidence.siteText) {
        evidence.siteNote = "The brand's site had no readable text.";
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      evidence.siteNote = `The brand's site could not be read: ${message}`;
    }
    return evidence;
  }
}
