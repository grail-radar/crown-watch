/**
 * What a run of model calls cost.
 *
 * A table, because the only interesting behaviour is the arithmetic and the
 * one refusal: a model whose rates we do not hold gets its tokens reported and
 * no dollar figure. #30 wants a catalogue-wide run budgeted *before* it is
 * started, and a budget built on an invented rate is worse than no budget.
 */
import { RATES_USD_PER_MTOK, costOf, ratesFor } from './pricing';

const tokens = (input: number, output: number) => ({
  inputTokens: input,
  outputTokens: output,
});

describe('ratesFor', () => {
  it('knows the models this project actually calls', () => {
    // The extraction default and the two it is realistically switched to.
    expect(ratesFor('claude-haiku-4-5')).toBeDefined();
    expect(ratesFor('claude-opus-4-8')).toBeDefined();
    expect(ratesFor('claude-opus-5')).toBeDefined();
  });

  it('does not guess at a model it has never been told about', () => {
    expect(ratesFor('claude-something-7')).toBeNull();
  });

  it('ignores case and surrounding whitespace, which an env var will have', () => {
    expect(ratesFor('  Claude-Haiku-4-5 ')).toEqual(ratesFor('claude-haiku-4-5'));
  });
});

describe('costOf', () => {
  it('charges input and output at their own rates', () => {
    // Haiku 4.5: $1 per Mtok in, $5 per Mtok out.
    const cost = costOf('claude-haiku-4-5', tokens(1_000_000, 1_000_000));

    expect(cost?.inputUsd).toBeCloseTo(1, 6);
    expect(cost?.outputUsd).toBeCloseTo(5, 6);
    expect(cost?.totalUsd).toBeCloseTo(6, 6);
  });

  it('scales down to the sizes a single Brand actually costs', () => {
    // The realistic shape: a short prompt, a shorter tool call.
    const cost = costOf('claude-haiku-4-5', tokens(2_000, 400));

    expect(cost?.totalUsd).toBeCloseTo(0.002 + 0.002, 6);
  });

  it('is zero for a call that never happened', () => {
    expect(costOf('claude-haiku-4-5', tokens(0, 0))?.totalUsd).toBe(0);
  });

  it('reports nothing at all for a model whose rates we do not hold', () => {
    // Not zero — zero would read as "this run was free", which is a worse lie
    // than "we cannot tell you". The caller still has the token counts.
    expect(costOf('claude-something-7', tokens(1_000, 1_000))).toBeNull();
  });

  it('costs an Opus token more than a Haiku one, which is the whole reason to report it', () => {
    const haiku = costOf('claude-haiku-4-5', tokens(100_000, 10_000))!;
    const opus = costOf('claude-opus-4-8', tokens(100_000, 10_000))!;

    expect(opus.totalUsd).toBeGreaterThan(haiku.totalUsd);
  });

  describe('the published rates it carries', () => {
    // Spelled out rather than asserted loosely: these are the numbers an
    // operator budgets a 300-Brand run against, and a typo in them is a wrong
    // budget rather than a failing test.
    it.each([
      ['claude-haiku-4-5', 1, 5],
      ['claude-opus-4-8', 5, 25],
      ['claude-opus-5', 5, 25],
      ['claude-sonnet-5', 3, 15],
    ])('%s is $%s in / $%s out per million', (model, input, output) => {
      expect(ratesFor(model)).toEqual({
        inputUsdPerMTok: input,
        outputUsdPerMTok: output,
      });
    });

    it('carries its own source and date, so a stale rate is discoverable', () => {
      expect(RATES_USD_PER_MTOK.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
