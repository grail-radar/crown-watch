/**
 * Assemble the facts behind a Brand's Annotation, so a person can write the
 * sentence in a minute rather than an afternoon.
 *
 * Dry run by default — prints what the run would cost and spends nothing:
 *
 *   pnpm --filter @crown-watch/api draft:annotations -- --limit=20
 *
 * Add --confirm to spend. Read the estimate first.
 *
 * **It never writes the Annotation, and it cannot.** The tool the model answers
 * through has no field for a sentence, and this path never touches
 * `brands.annotation` or `brands.status` (ADR-0009). What comes back is a
 * briefing; the judgement is yours, and it is the only part worth reading.
 *
 * Re-draft one Brand you did not like:
 *   pnpm --filter @crown-watch/api draft:annotations -- --brand=baltic --confirm
 *
 * Ask again about the Brands that came back with nothing — for after the asking
 * has changed, not as a way to hope for a better answer to the same question:
 *   pnpm --filter @crown-watch/api draft:annotations -- --retry-empty --confirm
 *
 * Throw one away (the Brand is untouched either way):
 *   pnpm --filter @crown-watch/api draft:annotations -- --reject=baltic
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AnnotationDraftService } from '../moderation/annotation-draft.service';
import { databaseHost } from '../prisma/local-database';
import { flag, option, options } from './args';

function money(usd: number | null): string {
  return usd === null ? 'unknown (no rate held for this model)' : `$${usd.toFixed(4)}`;
}

async function main(): Promise<void> {
  const logger = new Logger('draft:annotations');
  const limit = parseInt(option('limit') ?? '10', 10);
  const brandSlugs = options('brand');
  const reject = option('reject');
  const confirm = flag('confirm');
  const retryEmpty = flag('retry-empty');

  logger.log(
    `Database: ${databaseHost(process.env.DATABASE_URL) ?? '(none configured)'}`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const drafts = app.get(AnnotationDraftService);

    if (reject) {
      const removed = await drafts.reject(reject);
      process.stdout.write(
        removed
          ? `\nThrew away the draft for ${reject}. The Brand is untouched.\n`
          : `\nNo draft for ${reject} — nothing to throw away.\n`,
      );
      if (!removed) process.exitCode = 1;
      return;
    }

    const run = await drafts.draft({ limit, confirm, brandSlugs, retryEmpty });

    if (run.candidates === 0) {
      process.stdout.write(
        '\nNo Brands to draft. Every Brand either has an Annotation already or ' +
          'has a draft waiting for someone to write one.\n',
      );
      return;
    }

    if (run.estimate) {
      const e = run.estimate;
      process.stdout.write(
        `\nModel: ${run.draftedByModel}\n` +
          `Brands: ${e.brands}\n` +
          `  input   ~${e.inputTokens} tokens (counted, not guessed)\n` +
          `  output  at most ${e.maxOutputTokensPerBrand} tokens each\n` +
          `  worst case ${money(e.worstCaseUsd)} for the whole run\n`,
      );
    }

    if (!run.confirmed) {
      process.stdout.write('\nDry run — nothing was asked and nothing spent. Re-run with --confirm.\n');
      return;
    }

    process.stdout.write('\n');
    for (const brand of run.brands) {
      const mark =
        brand.status === 'usable'
          ? 'drafted '
          : brand.status === 'empty'
            ? 'nothing '
            : 'failed  ';
      process.stdout.write(`  ${mark} ${brand.name}\n`);
      if (brand.note) process.stdout.write(`           ${brand.note}\n`);
    }

    process.stdout.write(
      `\nDrafted ${run.drafted}; ${run.empty} had nothing useful; ${run.failed} could not be asked.\n` +
        `Actually used ${run.usage.inputTokens} in / ${run.usage.outputTokens} out — ${money(run.costUsd)}.\n` +
        `\nNothing has been published. Read the drafts, write the sentence yourself, and\n` +
        `approve it the way #22 describes — that step is what makes a Brand Curated.\n`,
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
