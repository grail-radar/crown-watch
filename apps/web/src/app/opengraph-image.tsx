import { ImageResponse } from 'next/og';

export const alt = 'Crown Watch — Microbrand watch drop & waitlist radar';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const gold = '#C9A96A';
const ink = '#ECE9E2';
const faint = '#918E85';

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          backgroundColor: '#101014',
          padding: 72,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flex: 1,
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
            INDEPENDENT HOROLOGY, TRACKED DAILY
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 92, color: ink }}>
              <span style={{ color: gold }}>Crown</span>
              <span style={{ marginLeft: 24 }}>Watch</span>
            </div>
            <div
              style={{
                display: 'flex',
                marginTop: 22,
                fontSize: 34,
                color: faint,
                maxWidth: 700,
                lineHeight: 1.35,
              }}
            >
              The microbrand watch drop &amp; waitlist radar — every launch,
              waitlist and restock in one feed.
            </div>
          </div>
          <div style={{ display: 'flex', fontSize: 20, color: faint }}>
            wornandwound · aBlogtoWatch · Monochrome · Fratello · Hodinkee
          </div>
        </div>
        {/* watch-bezel motif */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 320,
          }}
        >
          <div
            style={{
              display: 'flex',
              width: 260,
              height: 260,
              borderRadius: 260,
              border: `10px solid ${gold}`,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ display: 'flex', fontSize: 96, color: gold }}>C</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
