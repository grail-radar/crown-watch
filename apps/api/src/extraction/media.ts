/**
 * Pull display media out of a stored RSS payload: the article's lead image and
 * the link back to the original coverage. Coverage across our Tier 1 feeds:
 * aBlogtoWatch + Worn & Wound embed <img> in content / content:encoded;
 * Monochrome ships an enclosure URL.
 */
export interface PayloadMedia {
  imageUrl: string | null;
  sourceUrl: string | null;
}

const IMG_SRC = /<img[^>]+(?:src|data-src)=["']([^"']+)["']/i;

function httpUrl(value: unknown): string | null {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim())
    ? value.trim()
    : null;
}

export function extractMediaFromPayload(
  payload: Record<string, unknown> | null | undefined,
): PayloadMedia {
  if (!payload) return { imageUrl: null, sourceUrl: null };

  const sourceUrl = httpUrl(payload.link) ?? httpUrl(payload.guid);

  let imageUrl: string | null = null;
  for (const key of ['content', 'content:encoded', 'summary']) {
    const html = payload[key];
    if (typeof html === 'string') {
      const match = html.match(IMG_SRC);
      if (match && httpUrl(match[1])) {
        imageUrl = match[1];
        break;
      }
    }
  }
  if (!imageUrl) {
    const enclosure = payload.enclosure as
      | { url?: unknown; type?: unknown }
      | undefined;
    const enclosureUrl = httpUrl(enclosure?.url);
    const type = enclosure?.type;
    if (enclosureUrl && (typeof type !== 'string' || type.startsWith('image'))) {
      imageUrl = enclosureUrl;
    }
  }

  return { imageUrl, sourceUrl };
}
