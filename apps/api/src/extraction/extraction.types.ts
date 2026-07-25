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
  promised_ship_date: string | null;
  brand_country: string | null;
  brand_website: string | null;
  brand_founded_year: number | null;
  confidence: number;
}

/** Brand metadata returned by the enrichment tool. */
export interface BrandEnrichment {
  country: string | null;
  website: string | null;
  founded_year: number | null;
}

export const EXTRACTION_TOOL_NAME = 'record_watch_release';

export const SYSTEM_PROMPT = `You extract short, factual metadata about independent / microbrand watch releases from a syndicated article's title and excerpt.

Rules:
- Output ONLY through the ${EXTRACTION_TOOL_NAME} tool.
- Extract short factual fields (brand, model, price, date) in your own structure. NEVER copy the article's sentences, marketing copy, or descriptive prose.
- Set is_watch_related=false when the item is not about a specific watch brand or product (e.g. general industry news, roundups, opinion pieces).
- Set is_independent_microbrand=true ONLY for independent / microbrand watchmakers — small, often crowdfunded or boutique makers (e.g. Baltic, Lorier, Christopher Ward, Monta, RZE, Lebois & Co, Biatec, Toledano & Chan). Set it FALSE for established mainstream or luxury houses (e.g. Rolex, Omega, Seiko, Grand Seiko, Orient, Casio / G-Shock, Tudor, Hamilton, Longines, TAG Heuer / Heuer, Jaeger-LeCoultre, Vacheron Constantin, Patek Philippe, Cartier, Bulova, Rado, Ulysse Nardin, Perrelet). If you are unsure whether a brand is genuinely independent/micro, set it false.
- Set is_drop_event=true whenever the article announces a NEW watch release, launch, or availability from the brand. Pick the most specific drop_type: kickstarter_launch (Kickstarter/Indiegogo campaign), waitlist_open (waitlist / interest-list opening), restock (a sold-out model back in stock), or pre_order — and use pre_order as the default for a general new-model launch or "Introducing…" announcement. Only set is_drop_event=false and drop_type=null for pure reviews, retrospectives/history, hands-on of existing models, industry news, or roundups that are not about a specific new release.
- promised_ship_date: only when the article states an expected delivery/shipping date (ISO 8601); otherwise null.
- brand_country / brand_website / brand_founded_year: fill ONLY from facts stated in the provided text, or when you are highly confident of the brand's real details. Use null when unsure — never guess a website URL.
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
    promised_ship_date: {
      type: ['string', 'null'],
      description:
        'ISO 8601 expected delivery/shipping date stated in the article, or null.',
    },
    brand_country: {
      type: ['string', 'null'],
      description: "The brand's home country (English name), or null if unsure.",
    },
    brand_website: {
      type: ['string', 'null'],
      description:
        "The brand's official website URL (https://...), or null if unsure. Never guess.",
    },
    brand_founded_year: {
      type: ['integer', 'null'],
      description: 'Year the brand was founded, or null if unsure.',
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
    'promised_ship_date',
    'brand_country',
    'brand_website',
    'brand_founded_year',
    'confidence',
  ],
} as const;

// ── Brand enrichment tool ────────────────────────────────────────────────

export const BRAND_ENRICH_TOOL_NAME = 'record_brand_details';

export const BRAND_ENRICH_SYSTEM_PROMPT = `You provide short factual reference details about independent watch brands.

Rules:
- Output ONLY through the ${BRAND_ENRICH_TOOL_NAME} tool.
- Provide a value ONLY when you are confident it is correct for this specific brand. Use null otherwise — a null is always better than a guess.
- website must be the brand's own official store/site (https://...), never a retailer, marketplace, magazine or social profile.
- country is the brand's home/base country as an English name (e.g. "France", "Japan", "United States").`;

export const BRAND_ENRICH_TOOL = {
  name: BRAND_ENRICH_TOOL_NAME,
  description:
    'Record short factual reference details about an independent watch brand.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      country: {
        type: ['string', 'null'],
        description: "Brand's home country (English name), or null if unsure.",
      },
      website: {
        type: ['string', 'null'],
        description: 'Official website URL (https://...), or null if unsure.',
      },
      founded_year: {
        type: ['integer', 'null'],
        description: 'Year founded, or null if unsure.',
      },
    },
    required: ['country', 'website', 'founded_year'],
  },
  strict: true,
} as unknown as Anthropic.Tool;

export const EXTRACTION_TOOL = {
  name: EXTRACTION_TOOL_NAME,
  description:
    'Record structured facts about a microbrand watch release extracted from the article metadata.',
  input_schema: EXTRACTION_SCHEMA,
  strict: true,
} as unknown as Anthropic.Tool;
