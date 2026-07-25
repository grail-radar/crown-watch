import type Anthropic from '@anthropic-ai/sdk';

/** Structured result the model returns via the extraction tool. */
export interface ExtractionResult {
  is_watch_related: boolean;
  is_independent_microbrand: boolean;
  is_drop_event: boolean;
  brand_name: string | null;
  model_title: string | null;
  drop_type:
    | 'kickstarter_launch'
    | 'waitlist_open'
    | 'restock'
    | 'pre_order'
    | null;
  price_low: number | null;
  price_high: number | null;
  currency: string | null;
  event_date: string | null;
  confidence: number;
}

export const EXTRACTION_TOOL_NAME = 'record_watch_release';

export const SYSTEM_PROMPT = `You extract short, factual metadata about independent / microbrand watch releases from a syndicated article's title and excerpt.

Rules:
- Output ONLY through the ${EXTRACTION_TOOL_NAME} tool.
- Extract short factual fields (brand, model, price, date) in your own structure. NEVER copy the article's sentences, marketing copy, or descriptive prose.
- Set is_watch_related=false when the item is not about a specific watch brand or product (e.g. general industry news, roundups, opinion pieces).
- Set is_independent_microbrand=true ONLY for independent / microbrand watchmakers — small, often crowdfunded or boutique makers (e.g. Baltic, Lorier, Christopher Ward, Monta, RZE, Lebois & Co, Biatec, Toledano & Chan). Set it FALSE for established mainstream or luxury houses (e.g. Rolex, Omega, Seiko, Grand Seiko, Orient, Casio / G-Shock, Tudor, Hamilton, Longines, TAG Heuer / Heuer, Jaeger-LeCoultre, Vacheron Constantin, Patek Philippe, Cartier, Bulova, Rado, Ulysse Nardin, Perrelet). If you are unsure whether a brand is genuinely independent/micro, set it false.
- Set is_drop_event=true and a drop_type ONLY when the article clearly describes a purchasable event: a Kickstarter/Indiegogo launch, a waitlist opening, a restock, or a pre-order. A general "new watch announced" article is watch-related but usually NOT a drop event — leave drop_type null in that case.
- confidence is your 0..1 confidence in the extracted brand and event.`;

// JSON Schema for strict, structured tool output (CONTEXT.md §5).
const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    is_watch_related: {
      type: 'boolean',
      description: 'Is this about a specific watch brand or product?',
    },
    is_independent_microbrand: {
      type: 'boolean',
      description:
        'True ONLY for independent/microbrand watchmakers; false for established mainstream or luxury houses (Rolex, Omega, Seiko, Casio, Tudor, Hamilton, JLC, Vacheron, Bulova, Rado, etc.).',
    },
    is_drop_event: {
      type: 'boolean',
      description:
        'Is this a Kickstarter/Indiegogo launch, waitlist opening, restock, or pre-order?',
    },
    brand_name: {
      type: ['string', 'null'],
      description: 'The watch brand name, or null.',
    },
    model_title: {
      type: ['string', 'null'],
      description: 'The watch model / product name (short, factual), or null.',
    },
    drop_type: {
      // Nullable enum must be expressed via anyOf for Anthropic strict schema
      // validation — a union `type: ['string','null']` alongside `enum` is rejected.
      anyOf: [
        {
          type: 'string',
          enum: ['kickstarter_launch', 'waitlist_open', 'restock', 'pre_order'],
        },
        { type: 'null' },
      ],
      description: 'The drop event type, or null if not a drop event.',
    },
    price_low: { type: ['number', 'null'], description: 'Lowest price, or null.' },
    price_high: {
      type: ['number', 'null'],
      description: 'Highest price, or null.',
    },
    currency: {
      type: ['string', 'null'],
      description: 'ISO 4217 currency code, e.g. USD.',
    },
    event_date: {
      type: ['string', 'null'],
      description: 'ISO 8601 date of the event, or null.',
    },
    confidence: { type: 'number', description: 'Confidence from 0 to 1.' },
  },
  required: [
    'is_watch_related',
    'is_independent_microbrand',
    'is_drop_event',
    'brand_name',
    'model_title',
    'drop_type',
    'price_low',
    'price_high',
    'currency',
    'event_date',
    'confidence',
  ],
} as const;

export const EXTRACTION_TOOL = {
  name: EXTRACTION_TOOL_NAME,
  description:
    'Record structured facts about a microbrand watch release extracted from the article metadata.',
  input_schema: EXTRACTION_SCHEMA,
  strict: true,
} as unknown as Anthropic.Tool;
