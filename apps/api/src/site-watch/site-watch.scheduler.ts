import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { SiteWatchService } from './site-watch.service';

/**
 * Runs the Tier 4 poll unattended, so a restock detected at three in the
 * morning reaches the channels at three in the morning.
 *
 * Two triggers exist on purpose and neither can double-post: this in-process
 * cron, which only runs while the service is awake, and the GitHub Actions
 * workflow, which also wakes a sleeping free-tier host. Overlap is safe because
 * every alert goes through the `(drop_id, chat_id)` claim (ADR-0002), and a
 * concurrent poll of the same store either finds no change or loses the insert.
 *
 * Mirrors IngestionScheduler; per CONTEXT.md §3 both are the lightweight
 * interim until polling moves to Redis + BullMQ.
 */
@Injectable()
export class SiteWatchScheduler implements OnModuleInit {
  private readonly logger = new Logger(SiteWatchScheduler.name);
  private static readonly JOB_NAME = 'site-watch-poll';

  /**
   * Guards against a slow run overlapping the next tick *within this process*.
   * Cross-process overlap is handled by the claim, not by this flag.
   */
  private running = false;

  constructor(
    private readonly siteWatch: SiteWatchService,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const cronExpr = this.config.get<string>('siteWatch.pollCron') ?? '0 5 * * * *';
    const job = CronJob.from({
      cronTime: cronExpr,
      onTick: () => {
        void this.run('cron');
      },
    });
    this.registry.addCronJob(SiteWatchScheduler.JOB_NAME, job);
    job.start();
    this.logger.log(`Registered site-watch poll cron "${cronExpr}"`);

    if (this.config.get<boolean>('siteWatch.pollOnBoot')) {
      void this.run('boot');
    }
  }

  private async run(trigger: string): Promise<void> {
    if (this.running) {
      this.logger.warn(`(${trigger}) previous site-watch run still in flight — skipping`);
      return;
    }
    this.running = true;
    try {
      const result = await this.siteWatch.pollAll();
      // A run is a success even when individual stores failed; the counts are
      // how an operator sees the difference without reading every line.
      this.logger.log(
        `(${trigger}) ${result.sourceCount} source(s), ` +
          `${result.totalDropsCreated} drop(s), ` +
          `${result.totalBroadcastsSent} broadcast(s), ` +
          `${result.failureCount} failure(s), ${result.skippedCount} skipped, ` +
          `${result.refusedCount} refused, ${result.totalDeadLinks} dead link(s)`,
      );
    } catch (err) {
      // pollAll isolates per-source failures itself, so reaching here means
      // something broader broke. The next tick retries from scratch — no
      // manual intervention, per the ticket.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`(${trigger}) site-watch poll failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
