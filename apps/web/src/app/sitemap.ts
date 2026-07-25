import type { MetadataRoute } from 'next';
import { getBrands, getDrops } from '@/lib/api';
import { SITE_URL } from '@/lib/site';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ brands }, { drops }] = await Promise.all([
    getBrands(200),
    getDrops(200),
  ]);
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1,
    },
    ...brands.map((b) => ({
      url: `${SITE_URL}/brands/${b.slug}`,
      lastModified: new Date(b.createdAt),
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...drops.map((d) => ({
      url: `${SITE_URL}/drops/${d.id}`,
      lastModified: d.publishedAt ? new Date(d.publishedAt) : new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ];
}
