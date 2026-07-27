import { extractMediaFromPayload } from './media';

describe('extractMediaFromPayload', () => {
  it('returns nothing for an empty payload', () => {
    expect(extractMediaFromPayload(null)).toEqual({
      imageUrl: null,
      sourceUrl: null,
    });
  });

  it('takes the first image from the article body', () => {
    const { imageUrl } = extractMediaFromPayload({
      content: '<p>hi</p><img src="https://cdn.example.com/a.jpg" /><img src="https://cdn.example.com/b.jpg" />',
    });
    expect(imageUrl).toBe('https://cdn.example.com/a.jpg');
  });

  it('falls back to the encoded content when the summary has no image', () => {
    const { imageUrl } = extractMediaFromPayload({
      content: '<p>no pictures here</p>',
      'content:encoded': '<img src="https://cdn.example.com/c.jpg">',
    });
    expect(imageUrl).toBe('https://cdn.example.com/c.jpg');
  });

  it('falls back to an image enclosure', () => {
    const { imageUrl } = extractMediaFromPayload({
      enclosure: { url: 'https://cdn.example.com/d.jpg', type: 'image/jpeg' },
    });
    expect(imageUrl).toBe('https://cdn.example.com/d.jpg');
  });

  it('ignores a non-image enclosure', () => {
    const { imageUrl } = extractMediaFromPayload({
      enclosure: { url: 'https://cdn.example.com/e.mp3', type: 'audio/mpeg' },
    });
    expect(imageUrl).toBeNull();
  });

  it('rejects relative and javascript urls', () => {
    expect(
      extractMediaFromPayload({ content: '<img src="/local/a.jpg">' }).imageUrl,
    ).toBeNull();
    expect(
      extractMediaFromPayload({ link: 'javascript:alert(1)' }).sourceUrl,
    ).toBeNull();
  });

  it('prefers the link over the guid for attribution', () => {
    const { sourceUrl } = extractMediaFromPayload({
      link: 'https://example.com/article',
      guid: 'https://example.com/?p=123',
    });
    expect(sourceUrl).toBe('https://example.com/article');
  });
});
