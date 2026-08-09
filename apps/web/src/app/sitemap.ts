import type { MetadataRoute } from 'next';
import { getBrands, getWatches } from '@/lib/api';
import { SITE_URL } from '@/lib/site';

/**
 * What we ask search engines to index: Brands and Watches.
 *
 * **Drops are deliberately absent.** A Drop is an event, and "Baltic restocked
 * on 4 August" is a bad thing to rank for and a worse thing to land on three
 * months later. A Watch is the durable object people search for, and every
 * Drop URL now redirects to one — so nothing is lost by leaving them out, and
 * the redirects consolidate their ranking onto the page that deserves it.
 *
 * Accessories are excluded upstream by the API: nobody should find a gift card
 * in a search result (ADR-0006).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ brands }, watches] = await Promise.all([
    getBrands(200),
    getWatches(1000),
  ]);
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/drops`,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/submit`,
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    ...brands.map((b) => ({
      url: `${SITE_URL}/brands/${b.slug}`,
      lastModified: new Date(b.createdAt),
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    // Above brands on purpose: a watch page is what a search is usually for,
    // and it changes whenever its price or availability does.
    ...watches.map((w) => ({
      url: `${SITE_URL}/watches/${w.brand.slug}/${w.slug}`,
      lastModified: new Date(w.updatedAt),
      changeFrequency: 'daily' as const,
      priority: 0.9,
    })),
  ];
}
