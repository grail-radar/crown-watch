import { rssContentHash } from './content-hash';
import type { NormalizedRssItem } from './rss.service';

const item = (over: Partial<NormalizedRssItem> = {}): NormalizedRssItem => ({
  guid: null,
  link: null,
  title: null,
  isoDate: null,
  raw: {},
  ...over,
});

describe('rssContentHash', () => {
  it('is stable for the same identity', () => {
    const a = rssContentHash(item({ guid: 'abc' }));
    const b = rssContentHash(item({ guid: 'abc' }));
    expect(a).toBe(b);
  });

  it('ignores changes to the body once identity is fixed', () => {
    // Re-polling an edited article must not create a duplicate landing-zone row.
    const before = rssContentHash(item({ guid: 'abc', raw: { content: 'first' } }));
    const after = rssContentHash(item({ guid: 'abc', raw: { content: 'edited' } }));
    expect(after).toBe(before);
  });

  it('distinguishes different items', () => {
    expect(rssContentHash(item({ guid: 'abc' }))).not.toBe(
      rssContentHash(item({ guid: 'xyz' })),
    );
  });

  it('falls back to the link when there is no guid', () => {
    const viaLink = rssContentHash(item({ link: 'https://example.com/a' }));
    const viaGuid = rssContentHash(item({ guid: 'https://example.com/a' }));
    expect(viaLink).toBe(viaGuid);
  });

  it('falls back to title and date when there is neither guid nor link', () => {
    const a = rssContentHash(item({ title: 'A watch', isoDate: '2026-07-01' }));
    const b = rssContentHash(item({ title: 'A watch', isoDate: '2026-07-02' }));
    expect(a).not.toBe(b);
  });
});
