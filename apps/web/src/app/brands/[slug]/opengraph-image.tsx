import { ImageResponse } from 'next/og';
import { getBrand } from '@/lib/api';
import { brandTally } from '@/lib/format';

export const alt = 'Brand on Crown Watch';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const paper = '#FFFFFF';
const ink = '#0B0B0B';
const muted = '#6B6B6B';
const rule = '#E3E3E3';

/**
 * The share card for a Brand.
 *
 * When we have a judgement and it fits whole, the judgement *is* the card —
 * there is nothing better to put in front of somebody than the sentence they
 * came for. It is never clipped to make it fit: cutting "…let down by quality
 * control that varies" turns a warning into an endorsement, which is the one
 * failure this product cannot afford. Too long to set whole, and the card falls
 * back to the facts.
 */
const FITS_WHOLE = 150;

export default async function BrandOgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const brand = await getBrand(slug);
  const name = brand?.name ?? 'Crown Watch';
  // The same headline the page and the directory card carry, from the same
  // rule: watches are what a reader counts, and `drops` is now one entry per
  // Watch rather than a total, so quoting it here would have under-reported
  // the brand (#28).
  const tally = brandTally(brand?.watchCount ?? 0, brand?.drops.length ?? 0);
  const annotation = brand?.annotation ?? null;
  const verdict =
    annotation && annotation.length <= FITS_WHOLE ? annotation : null;

  const facts = [
    brand?.country,
    brand?.foundedYearEst ? `est. ${brand.foundedYearEst}` : null,
    tally ? `${tally} tracked` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: paper,
          padding: 80,
        }}
      >
        <div style={{ display: 'flex', fontSize: 26, color: muted }}>
          Crown Watch
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: name.length > 18 ? 68 : 88,
              color: ink,
              lineHeight: 1.05,
              letterSpacing: -1.5,
            }}
          >
            {name}
          </div>
          {verdict ? (
            <div
              style={{
                display: 'flex',
                marginTop: 32,
                fontSize: 36,
                color: ink,
                maxWidth: 960,
                lineHeight: 1.3,
              }}
            >
              {verdict}
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                marginTop: 28,
                fontSize: 30,
                color: muted,
              }}
            >
              {facts || 'On the radar'}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            paddingTop: 28,
            borderTop: `1px solid ${rule}`,
            fontSize: 22,
            color: muted,
          }}
        >
          {verdict
            ? 'Written and approved by a person. Nobody can pay to appear here.'
            : 'New releases, waitlists and restocks from independent watchmakers.'}
        </div>
      </div>
    ),
    size,
  );
}
