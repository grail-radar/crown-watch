import { ImageResponse } from 'next/og';
import { getBrand } from '@/lib/api';
import { monogram } from '@/lib/format';

export const alt = 'Brand on Crown Watch';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const gold = '#C9A96A';
const ink = '#ECE9E2';
const faint = '#918E85';

export default async function BrandOgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const brand = await getBrand(slug);
  const name = brand?.name ?? 'Crown Watch';
  const drops = brand?.drops.length ?? 0;
  const sub = brand
    ? `${drops > 0 ? `${drops} published drop${drops === 1 ? '' : 's'}` : 'On the radar'} · tracked by Crown Watch`
    : 'Microbrand watch drop & waitlist radar';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#101014',
          padding: 72,
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 22,
            letterSpacing: 8,
            color: faint,
          }}
        >
          MICROBRAND DROP RADAR
        </div>

        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              width: 180,
              height: 180,
              borderRadius: 180,
              border: `8px solid ${gold}`,
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 72,
              color: gold,
            }}
          >
            {monogram(name)}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginLeft: 48,
              flex: 1,
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: name.length > 18 ? 64 : 84,
                color: ink,
                lineHeight: 1.05,
              }}
            >
              {name}
            </div>
            <div
              style={{
                display: 'flex',
                marginTop: 18,
                fontSize: 30,
                color: faint,
              }}
            >
              {sub}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: 30, color: ink }}>
          <span style={{ color: gold }}>Crown</span>
          <span style={{ marginLeft: 10 }}>Watch</span>
        </div>
      </div>
    ),
    size,
  );
}
