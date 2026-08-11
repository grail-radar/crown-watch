import { ImageResponse } from 'next/og';

export const alt = 'Crown Watch — Microbrand watch drop & waitlist radar';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/*
 * The share card is the same world as the site: paper, ink, one hairline, no
 * accent and no ornament. It is always the light palette — a social card has no
 * reader preference to follow, and the light one is the considered palette.
 */
const paper = '#FFFFFF';
const ink = '#0B0B0B';
const muted = '#6B6B6B';
const rule = '#E3E3E3';

export default function OgImage() {
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
        <div style={{ display: 'flex', fontSize: 28, color: ink }}>
          Crown Watch
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: 76,
              color: ink,
              maxWidth: 940,
              lineHeight: 1.08,
              letterSpacing: -1.5,
            }}
          >
            Which microbrands exist, and which are worth your attention.
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 32,
              fontSize: 28,
              color: muted,
              maxWidth: 760,
              lineHeight: 1.4,
            }}
          >
            An independent reference for small watchmakers. Nothing here is paid
            for or sponsored.
          </div>
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
          Worn &amp; Wound · aBlogtoWatch · Monochrome · Fratello · Hodinkee
        </div>
      </div>
    ),
    size,
  );
}
