import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  EXTRACTION_TOOL,
  EXTRACTION_TOOL_NAME,
  ExtractionResult,
  SYSTEM_PROMPT,
} from './extraction.types';

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
}
