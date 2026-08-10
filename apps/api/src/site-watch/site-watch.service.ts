import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DropType,
  Prisma,
  SourceHealth,
  SourceType,
  WatchKind,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { AlertDispatchService } from '../alerts/alert-dispatch.service';
import { DropWriterService } from '../drops/drop-writer.service';
import { PrismaService } from '../prisma/prisma.service';
import { getAdapter, parseWatchConfig } from './adapters';
import { healthFor, isBackedOff, nextAttemptAt } from './backoff';
import { LinkVerdict } from './link-liveness';
import { LinkProbe } from './link-probe';
import { RobotsService } from './robots.service';
import { SiteFetcher } from './site-fetcher';
import { WatchWriterService } from './watch-writer.service';
import {
  hashSnapshot,
  normalizeSnapshot,
  ProductSnapshot,
  signalHash,
} from './snapshot';
import { diffWatches, WatchEvent, WatchEventKind } from './watch-events';
import { GroupingRules } from './watch-grouping';

/**
 * A store telling us to slow down. Distinct from a generic failure because it
 * carries the store's own `Retry-After`, which backoff honours.
 */
class RateLimited extends Error {
  constructor(
    status: number,
    readonly retryAfterSeconds: number | null | undefined,
  ) {
    super(
      `Store responded ${status} (rate limited)` +
        (retryAfterSeconds ? `; asked to retry after ${retryAfterSeconds}s` : ''),
    );
  }
}

/**
 * Pause between stores in one run. Each poll is a request to somebody else's
 * shop, and several brands often sit behind one platform edge.
 */
const DEFAULT_POLL_DELAY_MS = 2000;

/**
 * How many changes one poll of one store may announce before it is refused.
 *
 * No microbrand releases eleven watches in an hour. When a poll says they did,
 * the likeliest explanations are all upstream faults — a lost snapshot, a moved
 * endpoint, a redesigned store, an adapter that started reading the page
 * differently — and a Channel cannot unsend (ADR-0002), so the cost of being
 * wrong scales with every message that goes out before a human notices.
 *
 * Ten is deliberately above anything the feed has genuinely produced (three at
 * once is the record) and well below the smallest store in the 2026-08-07
 * incident, which announced twelve.
 */
const DEFAULT_MAX_CHANGES_PER_POLL = 10;

/** What a single detected change produced, for the poll report. */
export interface SiteWatchChangeReport {
  kind: WatchEventKind;
  type: DropType;
  title: string;
  url: string;
  /**
   * How many store products this one event covered. Above one, that is the
   * whole point of the Watch: three references, one message.
   */
  products: number;
  /** Channels this drop was posted to, for the operator running the poll. */
  broadcasts: number;
  /**
   * What the store said when asked whether `url` still leads anywhere.
   * `gone` is the only value that held the Drop back — see {@link vetLink}.
   */
  link: LinkVerdict;
}

/**
 * `ok`      — polled, whatever it found.
 * `skipped` — inside a backoff window, or robots.txt forbids the path. Not a
 *             failure: doing nothing was the correct behaviour.
 * `error`   — the poll was attempted and failed.
 * `refused` — the store answered and the poll worked, but what it found was too
 *             big to announce. Nothing was published; the source is held.
 */
export type SiteWatchSourceStatus = 'ok' | 'skipped' | 'error' | 'refused';

export interface SiteWatchSourceResult {
  sourceId: string;
  name: string | null;
  endpoint: string;
  status: SiteWatchSourceStatus;
  /** Health recorded against the source after this attempt. */
  health: SourceHealth;
  /** Failures in a row including this attempt; 0 once a source recovers. */
  consecutiveFailures: number;
  /** When this source may next be polled, while it is backing off. */
  nextAttemptAt: string | null;
  /** Why it was skipped — backoff or a robots.txt directive. */
  skippedReason?: string;
  /** Why the poll was refused, and how far over the threshold it was. */
  refusedReason?: string;
  /**
   * true when the store differs from the catalogue we last saw it show.
   *
   * "Last saw", not "last stored": a poll that finds nothing announceable
   * refreshes the stored payload in place, so a store that moves a price once
   * and then settles reports `changed` on that poll and on no other.
   */
  changed: boolean;
  /**
   * Whether this poll's catalogue was written to the landing zone.
   *
   * False on a store that has not moved, and — the point of #25 — on one whose
   * only movement was a price, a currency label or a photograph. None of those
   * can raise a Drop, so storing the payload would be recording an observation
   * nobody will ever read.
   */
  snapshotStored: boolean;
  /** true when this was the source's first ever snapshot */
  baseline: boolean;
  productCount: number;
  /**
   * Watches this poll recorded for the brand — the catalogue, not events. Kept
   * apart from `dropsCreated` on purpose: a baseline poll records a whole
   * catalogue and announces none of it.
   */
  watchesRecorded: number;
  /**
   * Straps, boxes, gift cards. Recorded in full and announced to nobody
   * (ADR-0006). Counted apart from `watchesRecorded`, not inside it.
   */
  accessoriesRecorded: number;
  /**
   * Accessories seen for the first time on this poll, by name.
   *
   * Named rather than merely counted because this is where a wrongly-silenced
   * watch shows up — the expensive misclassification. Standing accessories are
   * left out; they would drown the report every hour.
   */
  newAccessories: string[];
  /** Grouping corrections that re-homed a product on this poll (ADR-0003). */
  groupingOverridesApplied: number;
  /**
   * Corrections pointing at a product this store no longer lists. Reported so
   * an override that has quietly stopped applying is visible to whoever reads
   * the run, rather than only to whoever queries the table.
   */
  groupingOverridesUnmatched: string[];
  dropsCreated: number;
  /**
   * Drops this poll wrote but did not publish, because the store would not
   * serve the product they point at. They are waiting in the moderation queue
   * rather than lost — see {@link vetLink} and ADR-0007.
   */
  deadLinkCount: number;
  /** Telegram messages posted across all channels for this source's drops. */
  broadcastsSent: number;
  /**
   * The specific changes this poll turned into drops — or, when it was
   * `refused`, the ones it would have and did not.
   */
  changes: SiteWatchChangeReport[];
  error?: string;
}

export interface SiteWatchRunResult {
  startedAt: string;
  finishedAt: string;
  sourceCount: number;
  totalDropsCreated: number;
  totalBroadcastsSent: number;
  /** Sources that were attempted and failed. The run itself still succeeded. */
  failureCount: number;
  /** Sources deliberately left alone this run — backoff or robots.txt. */
  skippedCount: number;
  /** Sources held back: they changed too much at once to be announced. */
  refusedCount: number;
  /**
   * Drops written but not published across the whole run, because the store
   * would not serve the product page they point at. They are in the moderation
   * queue, not lost (ADR-0007).
   */
  totalDeadLinks: number;
  sources: SiteWatchSourceResult[];
}

@Injectable()
export class SiteWatchService {
  private readonly logger = new Logger(SiteWatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fetcher: SiteFetcher,
    private readonly drops: DropWriterService,
    private readonly watches: WatchWriterService,
    private readonly alerts: AlertDispatchService,
    private readonly robots: RobotsService,
    private readonly links: LinkProbe,
    private readonly config: ConfigService,
  ) {}

  /** How long to wait between requests to somebody else's shop. */
  private pollDelayMs(override?: number): number {
    return (
      override ??
      this.config.get<number>('siteWatch.pollDelayMs') ??
      DEFAULT_POLL_DELAY_MS
    );
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Poll every configured Tier 4 source.
   *
   * One brand's broken selector or unreachable store cannot blind the run: each
   * source is isolated, and the run reports success with its failures itemised
   * rather than throwing on the first one. A caller that treated any failure as
   * a failed run would page someone every time a single shop had a bad night.
   */
  async pollAll(options: { delayMs?: number } = {}): Promise<SiteWatchRunResult> {
    const startedAt = new Date();
    const delayMs = this.pollDelayMs(options.delayMs);
    const sources = await this.prisma.source.findMany({
      where: { type: SourceType.site_watch },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    const results: SiteWatchSourceResult[] = [];
    // Paced. Politeness has to mean the whole run, not each request in
    // isolation: four freshly registered stores answered 429 together on the
    // first real poll because this loop walked them back to back. Different
    // brands, but a shared platform edge sees one impatient crawler.
    let contactedAStore = false;
    for (const { id } of sources) {
      if (contactedAStore && delayMs > 0) await this.pause(delayMs);
      // The run's pace, not the configured one: an operator deliberately
      // polling slower must get slower link checks too, or the politeness knob
      // only half works.
      const result = await this.pollSource(id, { delayMs });
      results.push(result);
      // A skipped source — backing off, or disallowed — made no request, so it
      // should cost the run no time either.
      contactedAStore = result.status !== 'skipped';
    }

    const run: SiteWatchRunResult = {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      sourceCount: sources.length,
      totalDropsCreated: results.reduce((n, r) => n + r.dropsCreated, 0),
      totalBroadcastsSent: results.reduce((n, r) => n + r.broadcastsSent, 0),
      failureCount: results.filter((r) => r.status === 'error').length,
      skippedCount: results.filter((r) => r.status === 'skipped').length,
      refusedCount: results.filter((r) => r.status === 'refused').length,
      totalDeadLinks: results.reduce((n, r) => n + r.deadLinkCount, 0),
      sources: results,
    };

    this.logger.log(
      `Site-watch run: ${run.sourceCount} source(s), ${run.totalDropsCreated} drop(s), ` +
        `${run.totalBroadcastsSent} broadcast(s), ${run.failureCount} failure(s), ` +
        `${run.skippedCount} skipped, ${run.refusedCount} refused, ` +
        `${run.totalDeadLinks} held for moderation (dead link)`,
    );
    return run;
  }

  /**
   * Poll one store: fetch, normalise, and turn genuine catalogue changes into
   * published drops. Never throws — failures are recorded on the source's
   * health and returned in the result.
   *
   * `force` ignores an active backoff window. `release` waives the flood guard
   * for this one poll, which is how an operator publishes a change big enough
   * to have been refused once they have checked the store themselves.
   */
  async pollSource(
    sourceId: string,
    options: { force?: boolean; release?: boolean; delayMs?: number } = {},
  ): Promise<SiteWatchSourceResult> {
    const source = await this.prisma.source.findUniqueOrThrow({
      where: { id: sourceId },
    });
    const result: SiteWatchSourceResult = {
      sourceId: source.id,
      name: source.name,
      endpoint: source.endpoint,
      status: 'ok',
      health: source.healthStatus,
      consecutiveFailures: source.consecutiveFailures,
      nextAttemptAt: source.nextAttemptAt?.toISOString() ?? null,
      changed: false,
      snapshotStored: false,
      baseline: false,
      productCount: 0,
      watchesRecorded: 0,
      accessoriesRecorded: 0,
      newAccessories: [],
      groupingOverridesApplied: 0,
      groupingOverridesUnmatched: [],
      dropsCreated: 0,
      deadLinkCount: 0,
      broadcastsSent: 0,
      changes: [],
    };

    const now = new Date();

    // A store that pushed back is left alone until its window expires. Checked
    // before anything else so a backing-off source costs no request at all.
    if (!options.force && isBackedOff(source.nextAttemptAt, now)) {
      result.status = 'skipped';
      result.skippedReason = `backing off until ${source.nextAttemptAt!.toISOString()}`;
      return result;
    }

    try {
      if (!source.brandId) {
        throw new Error(
          'Site-watch source has no brand attached; a store belongs to exactly one brand.',
        );
      }

      // The brand's slug scopes watch identity, so two brands selling an
      // "Aquascaphe" never collapse into one watch.
      const brand = await this.prisma.brand.findUniqueOrThrow({
        where: { id: source.brandId },
        select: { slug: true },
      });

      const config = parseWatchConfig(source.watchConfig);
      const adapter = getAdapter(config.adapter);

      // Asked before fetching, never after: a disallowed path must not be
      // requested at all, which is the whole point of the directive.
      if (!(await this.robots.allows(source.endpoint))) {
        result.status = 'skipped';
        result.skippedReason = 'disallowed by robots.txt';
        this.logger.warn(
          `[${source.name ?? source.endpoint}] robots.txt disallows this path — not fetched`,
        );
        // Not a failure of the source, so health and backoff are untouched;
        // only the attempt time moves, so an operator can see we looked.
        await this.prisma.source.update({
          where: { id: source.id },
          data: { lastPolledAt: now },
        });
        return result;
      }

      const response = await this.fetcher.fetch(source.endpoint);
      if (response.status === 429 || response.status === 503) {
        // An explicit "slow down". Honour it as a first-class outcome rather
        // than as a generic error, so Retry-After can extend the window.
        throw new RateLimited(response.status, response.retryAfterSeconds);
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Store responded ${response.status}`);
      }

      const products = normalizeSnapshot(
        adapter(response.body, config, source.endpoint),
      );
      result.productCount = products.length;

      // An empty catalogue is far more often a broken selector or a blocked
      // request than a brand delisting everything. Refuse to treat it as truth.
      if (products.length === 0) {
        throw new Error('Adapter produced no products; refusing to snapshot');
      }

      // Read fresh every poll, and handed to both the catalogue writer and the
      // diff below. An operator's correction has to take effect on the next run
      // rather than on the next deploy (ADR-0003), and the two must group
      // identically or a Drop points at a Watch the brand page does not show.
      const overrides = await this.prisma.watchGroupingOverride.findMany({
        where: { brandId: source.brandId },
        select: { productUrl: true, watchKey: true, watchName: true },
      });
      // Corrections to what a product *is*, kept on the Watch row an operator
      // is already looking at rather than in a table of their own. Only rows
      // they have actually corrected are read; the rest follow the rule.
      const corrected = await this.prisma.watch.findMany({
        where: { brandId: source.brandId, kindOverride: { not: null } },
        select: { key: true, kindOverride: true },
      });
      const rules: GroupingRules = {
        overrides,
        kindOverrides: new Map(
          corrected.map((w) => [w.key, w.kindOverride as WatchKind]),
        ),
      };

      const previousRow = await this.previousSnapshot(source.id);
      const previous = previousRow?.products ?? null;
      const snapshotHash = hashSnapshot(products);

      // Two questions, and they are not the same question.
      //
      // `changed` — did the store's answer move at all? That is what an
      //   operator means by "did anything happen", and what the catalogue
      //   needs, since a price is real even when it is not news.
      // `announceable` — did it move in a way anybody could be told about? Only
      //   a product URL never seen before and availability turning true raise a
      //   Drop, so only those are worth a stored observation (#25).
      //
      // Compare against the PREVIOUS poll only. A catalogue legitimately
      // returns to an earlier state — in stock, sold out, in stock again — and
      // that return is precisely the restock we exist to catch.
      const contentMoved = !previous || hashSnapshot(previous) !== snapshotHash;
      const signalMoved = !previous || signalHash(previous) !== signalHash(products);
      result.changed = contentMoved;

      if (previous && !signalMoved) {
        // Nothing here can become a Drop, so no snapshot is stored and no diff
        // is run. YEMA's alternating market price lists were writing six to
        // eight payloads a day this way, every one of them a no-op.
        //
        // The catalogue is a different matter, and is rebuilt for any of three
        // reasons. The first is about the store; the other two are about *our*
        // state changing rather than the store's:
        //
        //  - the store moved on a field this hash ignores — a price, a currency
        //    label, a photograph. Real, not news, and the brand page reads
        //    prices off Variants rather than off snapshots, so skipping this
        //    would quietly staleness the site instead of the landing zone
        //  - the brand has no Watches at all, which is true of every source
        //    registered before Watches existed
        //  - this brand has grouping overrides, which an operator may have just
        //    written. A correction is nearly always made about a store that has
        //    no reason to change, so waiting for the catalogue to move would
        //    leave it unapplied indefinitely (ADR-0003 requires no deploy *and*
        //    no waiting).
        //
        // Recording is idempotent and announces nothing, so doing it costs
        // upserts and interrupts nobody. A store that has not moved at all and
        // needs nothing from us writes nothing but its own `last_polled_at`.
        const known = await this.prisma.watch.count({
          where: { brandId: source.brandId },
        });
        if (contentMoved || known === 0 || overrides.length > 0 || corrected.length > 0) {
          const recorded = await this.watches.record(
            source.brandId,
            brand.slug,
            products,
            rules,
          );
          result.watchesRecorded = recorded.watches;
          result.accessoriesRecorded = recorded.accessories;
          result.newAccessories = recorded.newAccessories;
          result.groupingOverridesApplied = recorded.overridesApplied;
          result.groupingOverridesUnmatched = recorded.overridesUnmatched;
        }
        // Bring the baseline up to date in place. Without this the comparison
        // above is against the last *stored* payload rather than the last one
        // *seen*, so a store that moved a price once and then settled would
        // read as changed at every poll from then on, and re-upsert its whole
        // catalogue hourly for ever.
        if (contentMoved && previousRow) {
          await this.refreshSnapshot(previousRow.id, products, snapshotHash);
        }
        await this.recordSuccess(source.id, result);
        return result; // nothing here could have been announced
      }

      // What this poll would announce, worked out before anything at all is
      // written down. A first sight of a store announces nothing by definition,
      // so it has no changes to weigh.
      const changes = previous
        ? diffWatches(brand.slug, previous, products, rules)
        : [];
      const limit = this.maxChangesPerPoll();
      // A source already held stays held whatever this poll's diff looks like.
      // Without that, a flood could walk through in instalments: a store that
      // drops a few products between polls presents a diff under the wall, and
      // the rest of the same flood is announced as if it had been reviewed.
      //
      // `previous` gates the whole guard, so a baseline poll is never refused —
      // it announces nothing by definition, and clearing the stored snapshot is
      // how an operator re-baselines a source whose flood was an artefact.
      const alreadyHeld = source.healthStatus === SourceHealth.held;
      if (previous && !options.release && (alreadyHeld || changes.length > limit)) {
        return this.refuse(source, result, changes, limit, alreadyHeld);
      }

      // Ask the store whether the pages we are about to send readers to exist,
      // for every candidate at once and **before anything is written down**.
      //
      // The position matters as much as the check. ADR-0002 accepts a window
      // between storing a snapshot and dispatching the alerts it implies: a
      // process that dies inside it leaves the products recorded as seen, so
      // novelty — decided by product URL — can never fire for them again.
      // Vetting is network I/O against a shop that may be slow, and doing it
      // after the snapshot would have widened that window by a timeout per
      // candidate. Here, a crash costs nothing: the old snapshot is still in
      // place and the next poll redoes the lot.
      //
      // A refused poll never reaches this line, so a store we have just decided
      // something is wrong with gets no burst of requests.
      const links = await this.links.check(
        changes.map((c) => c.lead.url),
        this.pollDelayMs(options.delayMs),
      );

      // Catalogue, not events — so this runs on the baseline poll too. A store
      // registered today has pages from the moment it is added, even though it
      // deliberately announces nothing.
      //
      // Deliberately BEFORE the snapshot is stored. If this throws halfway, the
      // poll fails with the old snapshot still in place, so the next one retries
      // the whole thing; storing first would record the catalogue as seen and
      // leave the half-written Watches unreachable until the store next changed.
      const recorded = await this.watches.record(
        source.brandId,
        brand.slug,
        products,
        rules,
      );
      result.watchesRecorded = recorded.watches;
      result.accessoriesRecorded = recorded.accessories;
      result.newAccessories = recorded.newAccessories;
      result.groupingOverridesApplied = recorded.overridesApplied;
      result.groupingOverridesUnmatched = recorded.overridesUnmatched;

      const created = await this.storeSnapshot(source.id, products, snapshotHash);
      result.changed = true;
      result.snapshotStored = true;

      if (!previous) {
        // First sight of this store: remember it, announce nothing.
        result.baseline = true;
        await this.recordSuccess(source.id, result);
        this.logger.log(
          `[${source.name ?? source.endpoint}] baseline recorded (${products.length} products)`,
        );
        return result;
      }

      for (const change of changes) {
        const type = this.dropType(change);
        // Decided above, before the snapshot was stored. Absent means the poll
        // never asked, which is not evidence of anything.
        const link = links.get(change.lead.url) ?? 'unverified';
        const dead = link === 'gone';
        const drop = await this.drops.create({
          brandId: source.brandId,
          // The Watch's tidied name, not one reference's raw title: the three
          // products behind one event may not spell it identically, and the
          // message is about the model.
          title: change.identity.name,
          watchId: recorded.watchIdByKey.get(change.identity.key) ?? null,
          type,
          priceLow: change.priceLow,
          // A span only when the references genuinely differ; the template
          // renders `priceLow`, so an equal pair would read no differently.
          priceHigh:
            change.priceHigh !== change.priceLow ? change.priceHigh : null,
          // From the event, not from `lead`: the two figures above and this
          // label are computed over the same references, so a Drop can never
          // quote a number in one currency under the name of another (#24).
          currency: change.currency,
          imageUrl: change.lead.imageUrl,
          sourceUrl: change.lead.url,
          sourceEventId: created.id,
          // A structural diff of the brand's own store — nothing was inferred.
          confidenceScore: 1,
          // ADR-0001 lets this lane publish unmoderated *because* nothing was
          // inferred. A product page the store will not serve falsifies that
          // for this one candidate, so it falls back to the lane everything
          // else uses rather than going out (ADR-0007).
          publish: !dead,
          // Recorded on the row, not only in a log line. Nothing re-derives
          // this: the snapshot has moved on, so no later poll raises the same
          // candidate, and without this the queue cannot tell a demoted Drop
          // from an ordinary extracted one.
          heldReason: dead
            ? `The store does not serve ${change.lead.url} (checked on this poll). ` +
              `Held rather than announced — see ADR-0007.`
            : null,
        });
        result.dropsCreated += 1;

        // The drop exists and is public the moment it is written; the broadcast
        // is what puts it on someone's phone. It never throws, so a silent
        // Telegram cannot fail the ingestion run that produced the drop.
        // Nothing unpublished is offered to a Channel — a reader must not be
        // sent somewhere we have just been told does not exist.
        const broadcast = dead
          ? { sentCount: 0 }
          : await this.alerts.broadcastDrop(drop.id);
        result.broadcastsSent += broadcast.sentCount;

        if (dead) {
          result.deadLinkCount += 1;
          this.logger.warn(
            `[${source.name ?? source.endpoint}] "${change.identity.name}" held for ` +
              `moderation: the store does not serve ${change.lead.url}`,
          );
        }

        result.changes.push({
          kind: change.kind,
          type,
          title: change.identity.name,
          url: change.lead.url,
          products: change.products.length,
          broadcasts: broadcast.sentCount,
          link,
        });
      }

      await this.recordSuccess(source.id, result);
      this.logger.log(
        `[${source.name ?? source.endpoint}] ${products.length} products, ` +
          `${result.dropsCreated} drop(s), ${result.broadcastsSent} broadcast(s)`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.status = 'error';
      result.error = message;
      await this.recordFailure(
        source.id,
        source.consecutiveFailures,
        message,
        err instanceof RateLimited ? (err.retryAfterSeconds ?? null) : null,
        result,
      );
      this.logger.error(
        `[${source.name ?? source.endpoint}] ${message} — ` +
          `${result.consecutiveFailures} failure(s) in a row, ` +
          `next attempt ${result.nextAttemptAt}`,
      );
    }

    return result;
  }

  /**
   * The most changes one poll may announce.
   *
   * Configuration rather than a constant, so a brand that genuinely publishes a
   * whole collection at once can be accommodated without a deploy. There is no
   * way to switch the wall off: a value that is absent, unparsable or
   * nonsensical falls back to the default rather than opening the gate, because
   * a mistyped environment variable must not be the thing that lets 372 drops
   * through.
   */
  private maxChangesPerPoll(): number {
    const configured = this.config.get<number>('siteWatch.maxChangesPerPoll');
    return typeof configured === 'number' &&
      Number.isFinite(configured) &&
      configured > 0
      ? Math.floor(configured)
      : DEFAULT_MAX_CHANGES_PER_POLL;
  }


  /**
   * Stop before publishing, and leave the source exactly where a human can pick
   * it up.
   *
   * **Nothing is written.** Not the Drops, not the alerts, not the snapshot, and
   * not the Watches — the catalogue would be built from the very payload this
   * poll just declined to believe. The snapshot is the load-bearing part:
   * storing it would make the next poll diff against the flood, find nothing,
   * and report a healthy store. The refusal would clear itself, and any genuine
   * Drop hiding inside the flood would be lost with it. Holding the old
   * snapshot instead makes the refusal repeatable — every poll re-derives the
   * same list from the live store, so an operator can see what is waiting at
   * any time, and `release` publishes it.
   *
   * The source is `held`, not failing: the store answered, so no failure streak
   * is running and no backoff window opens. That leaves the ordinary hourly
   * poll to keep re-checking, which is what an operator reads the report of.
   * Only a release, a re-baseline, or the store returning to the catalogue we
   * already hold ends this — see ADR-0005.
   *
   * `alreadyHeld` distinguishes the poll that raised the wall from the ones
   * that keep it up afterwards. The second kind may be under the threshold, so
   * saying it exceeded one would be a lie an operator has to unpick.
   */
  private async refuse(
    source: { id: string; name: string | null; endpoint: string },
    result: SiteWatchSourceResult,
    changes: WatchEvent[],
    limit: number,
    alreadyHeld: boolean,
  ): Promise<SiteWatchSourceResult> {
    const reason = alreadyHeld
      ? `Still held, with ${changes.length} change(s) waiting. Nothing was announced. ` +
        `Check the store, then re-poll with release=true to publish them.`
      : `Refused to publish ${changes.length} changes from one poll (limit ${limit}). ` +
        `Nothing was announced. Check the store, then re-poll with release=true to publish them.`;

    result.status = 'refused';
    result.refusedReason = reason;
    result.health = SourceHealth.held;
    result.consecutiveFailures = 0;
    result.nextAttemptAt = null;
    // The store did move — we simply refused to act on it. Reporting otherwise
    // would read as "nothing happened here".
    result.changed = true;
    result.changes = changes.map((change) => ({
      kind: change.kind,
      type: this.dropType(change),
      title: change.identity.name,
      url: change.lead.url,
      products: change.products.length,
      broadcasts: 0,
      // Not asked. A refused poll announces nothing, so there is nothing to
      // vet — and vetting first would turn one refusal into a burst of
      // requests at a store we have just decided something is wrong with.
      link: 'unverified' as LinkVerdict,
    }));

    await this.prisma.source.update({
      where: { id: source.id },
      data: {
        lastPolledAt: new Date(),
        healthStatus: SourceHealth.held,
        consecutiveFailures: 0,
        nextAttemptAt: null,
        lastError: reason.slice(0, 500),
      },
    });

    this.logger.warn(`[${source.name ?? source.endpoint}] ${reason}`);
    return result;
  }

  /**
   * A source that answered is healthy again, whatever it did last week.
   * Clearing the counter is what lets a store recover on its own.
   */
  private async recordSuccess(
    sourceId: string,
    result: SiteWatchSourceResult,
  ): Promise<void> {
    result.health = SourceHealth.healthy;
    result.consecutiveFailures = 0;
    result.nextAttemptAt = null;
    await this.prisma.source.update({
      where: { id: sourceId },
      data: {
        lastPolledAt: new Date(),
        healthStatus: SourceHealth.healthy,
        consecutiveFailures: 0,
        nextAttemptAt: null,
        lastError: null,
      },
    });
  }

  /**
   * Escalate: count the failure, widen the window, and record why — so an
   * operator can see which source is unhappy, and since when, without reading
   * logs.
   */
  private async recordFailure(
    sourceId: string,
    previousFailures: number,
    message: string,
    retryAfterSeconds: number | null,
    result: SiteWatchSourceResult,
  ): Promise<void> {
    const now = new Date();
    const failures = previousFailures + 1;
    const health = healthFor(failures);
    const nextAttempt = nextAttemptAt(failures, now, retryAfterSeconds);

    result.health = health;
    result.consecutiveFailures = failures;
    result.nextAttemptAt = nextAttempt.toISOString();

    await this.prisma.source.update({
      where: { id: sourceId },
      data: {
        lastPolledAt: now,
        healthStatus: health,
        consecutiveFailures: failures,
        nextAttemptAt: nextAttempt,
        // Truncated: this is a signal for an operator, not a stack trace store.
        lastError: message.slice(0, 500),
      },
    });
  }

  private dropType(change: WatchEvent): DropType {
    return change.kind === 'restock' ? DropType.restock : DropType.pre_order;
  }

  /**
   * The most recent snapshot held for this source, or null on first sight.
   *
   * The row id comes back with it because a poll that finds nothing
   * announceable refreshes this row in place rather than adding one — see
   * {@link refreshSnapshot}.
   */
  private async previousSnapshot(
    sourceId: string,
  ): Promise<{ id: string; products: ProductSnapshot[] } | null> {
    const event = await this.prisma.rawIngestionEvent.findFirst({
      where: { sourceId },
      orderBy: { fetchedAt: 'desc' },
      select: { id: true, rawPayload: true },
    });
    if (!event) return null;
    const payload = event.rawPayload as unknown;
    return Array.isArray(payload)
      ? { id: event.id, products: payload as ProductSnapshot[] }
      : null;
  }

  /**
   * Bring the stored snapshot up to date without adding a row.
   *
   * Called when the store moved on a field that can never raise a Drop. Two
   * things have to be true at once and only an in-place refresh gives both:
   *
   *  - **the landing zone must stop growing**, which is the whole of #25
   *  - **the baseline must stay current**, or every later poll compares a
   *    settled store against a stale payload, calls it changed, and re-upserts
   *    the whole catalogue hourly for ever. YEMA's A/B price rotation is the
   *    loud version of that; a store that changes a price once and never again
   *    is the quiet one.
   *
   * Safe for the diff by construction: this only ever runs when the signal is
   * unchanged, so every field the diff reads out of the snapshot — product URL,
   * title, availability — is identical either way. What is replaced is exactly
   * what nothing reads.
   */
  private async refreshSnapshot(
    id: string,
    products: ProductSnapshot[],
    snapshotHash: string,
  ): Promise<void> {
    const observedAt = new Date();
    await this.prisma.rawIngestionEvent.update({
      where: { id },
      data: {
        rawPayload: products as unknown as Prisma.InputJsonValue,
        // Kept consistent with the payload it identifies, and still carrying
        // the observation time so the unique constraint cannot reject a
        // catalogue state that legitimately recurs.
        contentHash: createHash('sha256')
          .update(`${snapshotHash}:${observedAt.toISOString()}`)
          .digest('hex'),
        // Moves with the payload, so this stays the row `previousSnapshot`
        // hands back.
        fetchedAt: observedAt,
      },
    });
  }

  /**
   * Persist the snapshot in the landing zone.
   *
   * `content_hash` is unique per source, but a site-watch snapshot is a point
   * in a time series rather than a one-off document: the same catalogue state
   * recurs whenever a watch sells out and comes back. So the stored hash
   * identifies this *observation* — content plus when it was seen — instead of
   * the content alone, which would make the constraint reject exactly the
   * restock this feature exists to detect.
   */
  private async storeSnapshot(
    sourceId: string,
    products: ProductSnapshot[],
    snapshotHash: string,
  ) {
    const observedAt = new Date();
    return this.prisma.rawIngestionEvent.create({
      data: {
        sourceId,
        contentHash: createHash('sha256')
          .update(`${snapshotHash}:${observedAt.toISOString()}`)
          .digest('hex'),
        rawPayload: products as unknown as Prisma.InputJsonValue,
        // Site-watch needs no LLM pass; the snapshot is already structured.
        processed: true,
      },
    });
  }

}
