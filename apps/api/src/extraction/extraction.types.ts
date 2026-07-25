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
- Set is_drop_event=true whenever the article announces a NEW watch release, launch, or availability from the brand. Pick the most specific drop_type: kickstarter_launch (Kickstarter/Indiegogo campaign), waitlist_open (waitlist / interest-list opening), restock (a sold-out model back in stock), or pre_order — and use pre_order as the default for a general new-model launch or "Introducing…" announcement. Only set is_drop_event=false and drop_type=null for pure reviews, retrospectives/history, hands-on of existing models, industry news, or roundups that are not about a specific new release.
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
        'Does the article announce a new watch release/launch/availability (Kickstarter, waitlist, restock, pre-order, or a general new-model launch)? False for pure reviews, history, or roundups.',
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
