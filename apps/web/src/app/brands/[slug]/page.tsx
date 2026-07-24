import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBrand } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function BrandPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const brand = await getBrand(slug);
  if (!brand) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-neutral-500 hover:underline">
        ← All brands
      </Link>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight">
        {brand.name}
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-500">
        {brand.country && <span>{brand.country}</span>}
        {brand.foundedYearEst && <span>est. {brand.foundedYearEst}</span>}
        <span className="capitalize">{brand.status}</span>
        {brand.website && (
          <a
            href={brand.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-700 underline dark:text-neutral-300"
          >
            Website
          </a>
        )}
      </div>

      <h2 className="mb-3 mt-10 text-lg font-semibold">Drops</h2>
      {brand.drops.length === 0 ? (
        <p className="text-neutral-500">No published drops yet.</p>
      ) : (
        <ul className="space-y-3">
          {brand.drops.map((d) => (
            <li
              key={d.id}
              className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <div className="font-medium">{d.title}</div>
              <div className="mt-1 text-sm text-neutral-500">
                {d.type.replace(/_/g, ' ')}
                {d.priceLow &&
                  ` · ${d.priceLow}${
                    d.priceHigh && d.priceHigh !== d.priceLow
                      ? `–${d.priceHigh}`
                      : ''
                  } ${d.currency ?? ''}`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
