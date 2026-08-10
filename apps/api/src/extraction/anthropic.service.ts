import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  BRAND_FACTS_MAX_TOKENS,
  BRAND_FACTS_SYSTEM_PROMPT,
  BRAND_FACTS_TOOL,
  BRAND_FACTS_TOOL_NAME,
  BrandFactsDraft,
} from './annotation-draft.types';
import {
  BRAND_ENRICH_SYSTEM_PROMPT,
  BRAND_ENRICH_TOOL,
  BRAND_ENRICH_TOOL_NAME,
  BrandEnrichment,
  EXTRACTION_TOOL,
  EXTRACTION_TOOL_NAME,
  ExtractionResult,
  SYSTEM_PROMPT,
} from './extraction.types';
import { TokenCount } from './pricing';

export interface ExtractionInput {
  title: string | null;
  snippet: string | null;
  link: string | null;
}

/**
 * Thin wrapper around the Anthropic SDK for the extraction stage (CONTEXT.md §5):
 * a single, well-defined extraction task via direct structured tool-use — no
 * LangChain/LlamaIndex. Degrades gracefully when no API key is configured so the
 * rest of the app keeps working.
 */
@Injectable()
export class AnthropicService {
  private readonly logger = new Logger(AnthropicService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('anthropic.apiKey');
    this.model =
      this.config.get<string>('anthropic.model') ?? 'claude-opus-4-8';
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    if (!this.client) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — extraction is disabled until it is configured.',
      );
    }
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  /** Extract structured watch-release facts from a single article's metadata. */
  async extract(input: ExtractionInput): Promise<ExtractionResult | null> {
    if (!this.client) {
      throw new Error('Anthropic client is not configured (missing API key).');
    }

    const userText = [
      input.title ? `Headline: ${input.title}` : null,
      input.snippet ? `Excerpt: ${input.snippet.slice(0, 1200)}` : null,
      input.link ? `Source URL: ${input.link}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: EXTRACTION_TOOL_NAME },
      messages: [{ role: 'user', content: userText }],
    });

    const block = message.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      this.logger.warn(
        `No tool_use block returned (stop_reason=${message.stop_reason}).`,
      );
      return null;
    }
    return block.input as ExtractionResult;
  }

  /** Look up short factual reference details for a brand by name. */
  async enrichBrand(brandName: string): Promise<BrandEnrichment | null> {
    if (!this.client) {
      throw new Error('Anthropic client is not configured (missing API key).');
    }
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      system: BRAND_ENRICH_SYSTEM_PROMPT,
      tools: [BRAND_ENRICH_TOOL],
      tool_choice: { type: 'tool', name: BRAND_ENRICH_TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: `Independent / microbrand watch brand: "${brandName}". Provide only details you are confident about.`,
        },
      ],
    });
    const block = message.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') return null;
    return block.input as BrandEnrichment;
  }

  /** Which model the annotation drafting runs on, for pricing and reporting. */
  draftModel(): string {
    return (
      this.config.get<string>('anthropic.draftModel') ??
      this.config.get<string>('anthropic.model') ??
      'claude-haiku-4-5'
    );
  }

  /**
   * What it would cost to *ask* about this brand, without asking.
   *
   * Counted by the API's own tokeniser rather than estimated from characters —
   * a character-based guess is wrong by tens of percent and this number is what
   * an operator decides a 300-Brand run on. Output is not counted because it
   * has not happened yet; the caller pairs this with
   * {@link BRAND_FACTS_MAX_TOKENS} for a worst case (#30).
   */
  async countDraftTokens(prompt: string): Promise<number> {
    if (!this.client) {
      throw new Error('Anthropic client is not configured (missing API key).');
    }
    const counted = await this.client.messages.countTokens({
      model: this.draftModel(),
      system: BRAND_FACTS_SYSTEM_PROMPT,
      tools: [BRAND_FACTS_TOOL],
      messages: [{ role: 'user', content: prompt }],
    });
    return counted.input_tokens;
  }

  /**
   * Assemble short factual fields about one brand.
   *
   * Returns the tokens it actually used alongside the facts, because #30 asks
   * for cost to be *reported* and not merely bounded — and the exact figure is
   * on the response, so estimating it afterwards would be inventing a number we
   * were handed.
   *
   * The judgement is not requested here and cannot be returned: the tool is
   * forced, validated, and has no field for a sentence (ADR-0009).
   */
  async draftBrandFacts(
    prompt: string,
  ): Promise<{ facts: BrandFactsDraft | null; usage: TokenCount; model: string }> {
    if (!this.client) {
      throw new Error('Anthropic client is not configured (missing API key).');
    }
    const model = this.draftModel();
    const message = await this.client.messages.create({
      model,
      // The bound on the expensive half of the bill. Five short fields cannot
      // legitimately need more, so this is a ceiling rather than a guess.
      max_tokens: BRAND_FACTS_MAX_TOKENS,
      system: BRAND_FACTS_SYSTEM_PROMPT,
      tools: [BRAND_FACTS_TOOL],
      tool_choice: { type: 'tool', name: BRAND_FACTS_TOOL_NAME },
      messages: [{ role: 'user', content: prompt }],
    });

    const usage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
    const block = message.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      // Billed but useless. Reported rather than swallowed, so a model that
      // stops answering through the tool shows up as cost with no drafts
      // instead of as a quiet run of failures.
      this.logger.warn(
        `No tool_use block for brand facts (stop_reason=${message.stop_reason}).`,
      );
      return { facts: null, usage, model };
    }
    return { facts: block.input as BrandFactsDraft, usage, model };
  }
}
