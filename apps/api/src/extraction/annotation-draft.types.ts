import Anthropic from '@anthropic-ai/sdk';

/**
 * The facts a model is asked to assemble about a Brand.
 *
 * **Every field is short and factual, and there is no field for a sentence.**
 * That is the guarantee, and it is structural rather than a request: with
 * `tool_choice` forcing this tool and `strict: true` validating it, the model
 * has nowhere to put prose even if it wanted to. An instruction saying "do not
 * write the judgement" would be a request; a schema with no such field is not
 * (ADR-0009).
 *
 * What we already know is deliberately absent too — country, founding year and
 * the price band are read from our own database, so asking a model to
 * re-derive them would be spending money to introduce disagreement.
 */
export interface BrandFactsDraft {
  /** Who makes the movements — "Sellita", "Miyota", "in-house". */
  movement_supplier: string | null;
  /**
   * Whether the brand makes its own movements. Separate from the supplier
   * because "in-house" is the claim buyers argue about, and a null here is a
   * genuine "we do not know" rather than "no".
   */
  in_house_movement: boolean | null;
  /**
   * A few short noun phrases — "bronze divers", "field watches under £500".
   * Tags, not prose: the length cap in `annotation-draft.service.ts` is what
   * keeps a sentence from arriving disguised as a tag.
   */
  known_for: string[];
  /** One model a reader would recognise the brand by, if there is one. */
  signature_watch: string | null;
  /** Where it is assembled, when that differs from where the brand is based. */
  assembled_in: string | null;
}

export const BRAND_FACTS_TOOL_NAME = 'record_brand_facts';

export const BRAND_FACTS_SYSTEM_PROMPT = `You assemble short factual reference details about independent / microbrand watch brands, for a human editor who will write the opinion themselves.

Rules:
- Output ONLY through the ${BRAND_FACTS_TOOL_NAME} tool.
- Facts only. Never write an opinion, a recommendation, a verdict, or a sentence of prose. Someone else writes those, and a field that reads like marketing is worse than an empty one.
- Never reproduce the brand's own marketing copy or any article's wording. Short factual fields in your own words, as with any extraction task.
- Provide a value ONLY when you are confident it is correct for this specific brand. Use null, or an empty list, when you are not. A null is always better than a guess, and this draft is read by a person who will notice.
- known_for: at most 4 entries, each a short noun phrase of a few words — "bronze divers", "in-house chronographs", "field watches". Not sentences, not clauses, no punctuation.
- movement_supplier: who supplies the movements (e.g. "Sellita", "Miyota", "La Joux-Perret"), or "in-house" when the brand makes its own.
- Do not report the brand's country, founding year, or prices. Those are already known and are not being asked for.`;

const BRAND_FACTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    movement_supplier: {
      type: ['string', 'null'],
      description:
        'Who supplies the movements, e.g. "Sellita", "Miyota", or "in-house". Null if unsure.',
    },
    in_house_movement: {
      type: ['boolean', 'null'],
      description:
        'True only when the brand makes its own movements. Null if unsure.',
    },
    known_for: {
      type: 'array',
      description:
        'Up to 4 short noun phrases the brand is known for. Never sentences.',
      items: { type: 'string' },
    },
    signature_watch: {
      type: ['string', 'null'],
      description: 'One model the brand is recognised by, or null.',
    },
    assembled_in: {
      type: ['string', 'null'],
      description:
        'Where the watches are assembled, when different from the brand’s home country. Null if unsure or the same.',
    },
  },
  required: [
    'movement_supplier',
    'in_house_movement',
    'known_for',
    'signature_watch',
    'assembled_in',
  ],
};

export const BRAND_FACTS_TOOL = {
  name: BRAND_FACTS_TOOL_NAME,
  description:
    'Record short factual reference details about an independent watch brand, for a human editor writing the opinion.',
  input_schema: BRAND_FACTS_SCHEMA,
  strict: true,
} as unknown as Anthropic.Tool;

/**
 * The most tokens one Brand's draft may produce.
 *
 * A hard ceiling on the expensive half of the bill, and the thing that makes
 * "cost per Brand is bounded" true rather than hoped for: five short fields
 * cannot legitimately need more, and a model that wants more is writing prose.
 */
export const BRAND_FACTS_MAX_TOKENS = 512;
