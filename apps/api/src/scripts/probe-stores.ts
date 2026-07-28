/**
 * Sort candidate brands into "can be watched, and how".
 *
 *   pnpm --filter @crown-watch/api probe:stores -- yema.com baltic-watches.com
 *   pnpm --filter @crown-watch/api probe:stores -- --file=brands.txt
 *
 * Read-only: it fetches each store's product feed path and reports what it
 * found. Nothing is registered — turning a usable result into a watched source
 * is a deliberate step, described in docs/operations/site-watch-runbook.md.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { AppModule } from '../app.module';
import { StoreProbe } from '../site-watch/store-probe';

function domainsFromArgs(): string[] {
  const fromFile = process.argv
    .find((arg) => arg.startsWith('--file='))
    ?.split('=')[1];

  const listed = process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith('--'))
    .flatMap((arg) => arg.split(','));

  const fileLines = fromFile
    ? readFileSync(fromFile, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.split('#')[0].trim())
        .filter(Boolean)
    : [];

  return [...new Set([...listed, ...fileLines])].filter(Boolean);
}

async function main(): Promise<void> {
  const logger = new Logger('probe:stores');
  const domains = domainsFromArgs();

  if (domains.length === 0) {
    logger.error(
      'Give one or more brand domains, or --file=<path> with one per line.',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const results = await app.get(StoreProbe).probe(domains);
    const of = (outcome: string) => results.filter((r) => r.outcome === outcome);

    // Grouped by what the operator should do next, not by status code.
    const sections: Array<[string, typeof results]> = [
      ['Register with the structured adapter', of('structured_feed')],
      ['Needs HTML selectors', of('needs_selectors')],
      ['Probe again later — pushed back, may still have a feed', of('retry_later')],
      ['Off limits — robots.txt says no', of('forbidden')],
      ['No answer', of('unreachable')],
    ];

    for (const [heading, group] of sections) {
      if (group.length === 0) continue;
      process.stdout.write(`\n── ${heading} (${group.length}) ──\n`);
      for (const r of group) {
        process.stdout.write(`  ${r.domain}\n    ${r.detail}\n`);
        if (r.usable) {
          process.stdout.write(
            `    endpoint: ${r.endpoint}\n    e.g. ${r.sample.join(' · ')}\n`,
          );
        }
      }
    }

    const ready = of('structured_feed').length;
    process.stdout.write(
      `\n${ready} of ${results.length} ready to register as-is.\n` +
        'Registering one: docs/operations/site-watch-runbook.md\n\n',
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
