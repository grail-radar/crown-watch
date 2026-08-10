import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AnthropicService } from './anthropic.service';
import {
  BRAND_FACTS_MAX_TOKENS,
  BrandFactsDraft,
} from './annotation-draft.types';
import { costOf } from './pricing';

/**
 * The longest a "fact" may be before it is prose wearing a fact's clothes.
 *
 * `known_for` is meant to hold tags — "bronze divers", "in-house chronographs".
 * A sixty-character limit comfortably fits the longest honest tag and excludes
 * a clause, which is the shape a lifted sentence of marketing copy arrives in
 * (`CONTEXT.md` §6).
 */
const MAX_TAG_LENGTH = 60;

/** How many tags are worth a writer's attention. Beyond four it is padding. */
const MAX_TAGS = 4;

/** The most Brands one run will draft, whatever it is asked for. */
const MAX_BRANDS_PER_RUN = 100;

export interface DraftRequest {
  /** How many Brands to draft. Clamped to {@link MAX_BRANDS_PER_RUN}. */
  limit?: number;
  /** Actually call the model. Omitted or false estimates and spends nothing. */
  confirm?: boolean;
  /**
   * Specific Brands, by slug. Named Brands are drafted even if they already
   * have a draft — that is the re-draft path for an operator who did not like
   * what came back. Without it, the run picks unannotated, undrafted Brands.
   */
  brandSlugs?: string[];
}

/** What a run would cost before any of it is spent. */
export interface DraftEstimate {
  brands: number;
  /** Counted by the API's tokeniser, not guessed from characters. */
  inputTokens: number;
  /** The output ceiling, per brand — a worst case, not a prediction. */
  maxOutputTokens: number;
  /** Null when we hold no rate for the model; the tokens above still stand. */
  worstCaseUsd: number | null;
}

export interface DraftRun {
  confirmed: boolean;
  model: string;
  /** Brands considered — the queue this run was drawn from. */
  candidates: number;
  drafted: number;
  /** Drafted, but with nothing worth handing to a writer. */
  insufficient: number;
  /** The model could not be asked at all. */
  failed: number;
  usage: { inputTokens: number; outputTokens: number };
  /** Null when we hold no rate for the model. Tokens above are still exact. */
  costUsd: number | null;
  estimate: DraftEstimate | null;
  brands: Array<{ slug: string; name: string; sufficient: boolean; note?: string }>;
}

/**
 * Assembles the facts behind a Brand's Annotation — and never the Annotation.
 *
 * The Annotation is what this project sells (`CONTEXT.md` §2), and the only
 * part of it worth reading is the judgement. A model is good at gathering
 * facts and bad at judgement, so the two are split: this collects the facts a
 * writer needs in front of them, and a person writes the sentence.
 *
 * **Nothing here can write one.** The tool the model answers through has no
 * field for prose, and this service never touches `brands.annotation` or
 * `brands.status`. That is stronger than instructing it not to (ADR-0009).
 *
 * It is also why rejecting a draft is safe: drafting writes only to
 * `brand_annotation_drafts`, so throwing one away is a delete and cannot leave
 * a Brand half-annotated (#30).
 */
@Injectable()
export class AnnotationDraftService {
  private readonly logger = new Logger(AnnotationDraftService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anthropic: AnthropicService,
  ) {}

  async draft(request: DraftRequest = {}): Promise<DraftRun> {
    if (!this.anthropic.isEnabled()) {
      // Refused rather than reported as a run of zero: an unconfigured key is
      // a setup problem, and "0 brands drafted, no errors" hides it.
      throw new Error(
        'Anthropic is not configured (ANTHROPIC_API_KEY), so nothing can be drafted.',
      );
    }

    const model = this.anthropic.draftModel();
    const limit = Math.min(Math.max(request.limit ?? 10, 1), MAX_BRANDS_PER_RUN);
    const candidates = await this.candidates(limit, request.brandSlugs);

    const run: DraftRun = {
      confirmed: request.confirm === true,
      model,
      candidates: candidates.length,
      drafted: 0,
      insufficient: 0,
      failed: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      costUsd: null,
      estimate: null,
      brands: [],
    };

    if (candidates.length === 0) return run;

    // The estimate is free and is what a catalogue-wide run is budgeted on, so
    // it is computed on every run — including a confirmed one, where it is the
    // number an operator can hold the actual spend against afterwards.
    run.estimate = await this.estimate(candidates, model);
    if (!run.confirmed) return run;

    for (const brand of candidates) {
      const outcome = await this.draftOne(brand, model);
      run.usage.inputTokens += outcome.usage.inputTokens;
      run.usage.outputTokens += outcome.usage.outputTokens;
      if (outcome.failed) run.failed += 1;
      else if (outcome.sufficient) run.drafted += 1;
      else run.insufficient += 1;
      run.brands.push({
        slug: brand.slug,
        name: brand.name,
        sufficient: outcome.sufficient,
        ...(outcome.note ? { note: outcome.note } : {}),
      });
    }

    run.costUsd = costOf(model, run.usage)?.totalUsd ?? null;
    this.logger.log(
      `Drafted ${run.drafted}, ${run.insufficient} with nothing useful, ` +
        `${run.failed} failed; ${run.usage.inputTokens} in / ` +
        `${run.usage.outputTokens} out on ${model}` +
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
   * A Brand a person has already written about is skipped: 37 Brands are
   * unannotated, and re-drafting the rest is money spent to produce nothing.
   * A Brand that already has a draft is skipped too, unless it was named — an
   * operator naming a slug means "do this one again".
   */
  private async candidates(limit: number, slugs?: string[]) {
    const named = slugs && slugs.length > 0;
    return this.prisma.brand.findMany({
      where: named
        ? { slug: { in: slugs } }
        : { annotation: null, annotationDraft: { is: null } },
      orderBy: named ? { name: 'asc' } : { createdAt: 'asc' },
      take: named ? slugs!.length : limit,
      select: {
        id: true,
        name: true,
        slug: true,
        country: true,
        foundedYearEst: true,
        website: true,
        _count: { select: { watches: true, drops: true } },
      },
    });
  }

  private async estimate(
    candidates: Awaited<ReturnType<AnnotationDraftService['candidates']>>,
    model: string,
  ): Promise<DraftEstimate> {
    // One real count, not one per brand: the prompts differ by a brand name and
    // a couple of short fields, so counting every one would spend a request per
    // brand to refine a number by a rounding error.
    const perBrandInput = await this.anthropic.countDraftTokens(
      this.promptFor(candidates[0]),
    );
    const inputTokens = perBrandInput * candidates.length;
    const maxOutputTokens = BRAND_FACTS_MAX_TOKENS * candidates.length;
    return {
      brands: candidates.length,
      inputTokens,
      maxOutputTokens: BRAND_FACTS_MAX_TOKENS,
      worstCaseUsd:
        costOf(model, { inputTokens, outputTokens: maxOutputTokens })?.totalUsd ??
        null,
    };
  }

  private async draftOne(
    brand: Awaited<ReturnType<AnnotationDraftService['candidates']>>[number],
    model: string,
  ): Promise<{
    usage: { inputTokens: number; outputTokens: number };
    sufficient: boolean;
    failed: boolean;
    note?: string;
  }> {
    let raw: BrandFactsDraft | null = null;
    let usage = { inputTokens: 0, outputTokens: 0 };
    try {
      const answer = await this.anthropic.draftBrandFacts(this.promptFor(brand));
      raw = answer.facts;
      usage = answer.usage;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Draft failed for ${brand.slug}: ${message}`);
      await this.store(brand, model, usage, null, `Drafting failed: ${message}`);
      return { usage, sufficient: false, failed: true, note: message };
    }

    const facts = raw ? this.clean(raw) : null;
    const note = this.shortfall(facts);
    await this.store(brand, model, usage, facts, note);
    return { usage, sufficient: note === null, failed: false, ...(note ? { note } : {}) };
  }

  /**
   * Keep the facts; drop anything that arrived as prose.
   *
   * The length cap is the copyright guard (`CONTEXT.md` §6): a tag is a few
   * words, and a clause of somebody's marketing copy is not. Truncating would
   * be worse than dropping — a half-sentence is still their sentence, and it
   * would read as a fact.
   */
  private clean(facts: BrandFactsDraft) {
    const tag = (value: string) => value.trim();
    const knownFor = (facts.known_for ?? [])
      .filter((v): v is string => typeof v === 'string')
      .map(tag)
      .filter((v) => v.length > 0 && v.length <= MAX_TAG_LENGTH)
      .slice(0, MAX_TAGS);

    const field = (value: string | null | undefined) => {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      return trimmed.length > 0 && trimmed.length <= MAX_TAG_LENGTH
        ? trimmed
        : null;
    };

    return {
      movementSupplier: field(facts.movement_supplier),
      inHouseMovement:
        typeof facts.in_house_movement === 'boolean'
          ? facts.in_house_movement
          : null,
      knownFor,
      signatureWatch: field(facts.signature_watch),
      assembledIn: field(facts.assembled_in),
    };
  }

  /** Why this draft is not worth handing to a writer, or null when it is. */
  private shortfall(facts: ReturnType<AnnotationDraftService['clean']> | null) {
    if (!facts) return 'The model returned nothing through the tool.';
    const anything =
      facts.movementSupplier !== null ||
      facts.inHouseMovement !== null ||
      facts.knownFor.length > 0 ||
      facts.signatureWatch !== null ||
      facts.assembledIn !== null;
    // An empty draft that looks confident is the failure this guards: a writer
    // opening it would take "no movement supplier" for a fact about the brand
    // rather than a fact about us.
    return anything
      ? null
      : 'The model knew nothing usable about this brand — every field came back empty or as prose.';
  }

  /**
   * The briefing, including what we already hold.
   *
   * Country, founding year and the catalogue counts are ours; they are written
   * into the draft rather than asked for, because paying a model to re-derive a
   * fact we already have buys nothing but the chance of disagreement.
   */
  private async store(
    brand: Awaited<ReturnType<AnnotationDraftService['candidates']>>[number],
    model: string,
    usage: { inputTokens: number; outputTokens: number },
    facts: ReturnType<AnnotationDraftService['clean']> | null,
    note: string | null,
  ) {
    const payload = {
      name: brand.name,
      website: brand.website,
      country: brand.country,
      foundedYearEst: brand.foundedYearEst,
      watchCount: brand._count.watches,
      dropCount: brand._count.drops,
      ...(facts ?? {
        movementSupplier: null,
        inHouseMovement: null,
        knownFor: [] as string[],
        signatureWatch: null,
        assembledIn: null,
      }),
    };

    await this.prisma.brandAnnotationDraft.upsert({
      where: { brandId: brand.id },
      create: {
        brandId: brand.id,
        facts: payload as unknown as Prisma.InputJsonValue,
        sufficient: note === null,
        note,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
      update: {
        facts: payload as unknown as Prisma.InputJsonValue,
        sufficient: note === null,
        note,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
    });
  }

  /** What the model is asked. Deliberately short — this is a lookup, not a brief. */
  private promptFor(
    brand: Awaited<ReturnType<AnnotationDraftService['candidates']>>[number],
  ): string {
    return [
      `Independent / microbrand watch brand: "${brand.name}".`,
      brand.country ? `Based in: ${brand.country}.` : null,
      brand.website ? `Official site: ${brand.website}.` : null,
      'Record only details you are confident about for this specific brand.',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
