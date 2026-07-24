import { createHash } from 'node:crypto';
import type { NormalizedRssItem } from './rss.service';

/**
 * Stable identity hash for a feed item — the dedup key for
 * raw_ingestion_events.content_hash (CONTEXT.md §5).
 *
 * We hash the item's stable identity (guid > link > title+date) rather than the
 * full body: re-polling the same source must not create duplicate landing-zone
 * rows, and cosmetic edits to an article shouldn't either. Combined with the
 * (source_id, content_hash) unique constraint, this makes re-polls idempotent.
 */
export function rssContentHash(item: NormalizedRssItem): string {
  const identity =
    item.guid?.trim() ||
    item.link?.trim() ||
    `${item.title ?? ''}::${item.isoDate ?? ''}`;
  return createHash('sha256').update(identity).digest('hex');
}
