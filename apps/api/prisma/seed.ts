import { PrismaClient, SourceHealth, SourceType } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Tier 1 (CONTEXT.md §4) — watch publication RSS feeds.
 * Endpoints verified live; note Hodinkee is /articles.rss (plain /rss is 404).
 */
const RSS_SOURCES: Array<{ name: string; endpoint: string }> = [
  { name: 'Worn & Wound', endpoint: 'https://wornandwound.com/feed/' },
  { name: 'aBlogtoWatch', endpoint: 'https://www.ablogtowatch.com/feed/' },
  { name: 'Monochrome Watches', endpoint: 'https://monochrome-watches.com/feed/' },
  { name: 'Fratello', endpoint: 'https://www.fratellowatches.com/feed/' },
  { name: 'Hodinkee', endpoint: 'https://www.hodinkee.com/articles.rss' },
];

async function main(): Promise<void> {
  for (const { name, endpoint } of RSS_SOURCES) {
    const source = await prisma.source.upsert({
      where: { type_endpoint: { type: SourceType.rss, endpoint } },
      update: { name },
      create: {
        type: SourceType.rss,
        name,
        endpoint,
        healthStatus: SourceHealth.unknown,
      },
    });
    // eslint-disable-next-line no-console
    console.log(`Seeded RSS source: ${source.name} -> ${source.id}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
