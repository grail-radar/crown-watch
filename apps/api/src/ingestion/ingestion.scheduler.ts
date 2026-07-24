import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { IngestionService } from './ingestion.service';

/**
 * Registers the recurring Tier 1 RSS poll using a cron expression from config
 * (RSS_POLL_CRON). This is the lightweight scheduler for now; per CONTEXT.md §3
 * the production polling/dispatch path is intended to move to Redis + BullMQ.
 */
@Injectable()
export class IngestionScheduler implements OnModuleInit {
  private readonly logger = new Logger(IngestionScheduler.name);
  private static readonly JOB_NAME = 'rss-poll';

  constructor(
    private readonly ingestion: IngestionService,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const cronExpr = this.config.get<string>('rss.pollCron') ?? '0 */15 * * * *';
    const job = CronJob.from({
      cronTime: cronExpr,
      onTick: () => {
        void this.run('cron');
      },
    });
    this.registry.addCronJob(IngestionScheduler.JOB_NAME, job);
    job.start();
    this.logger.log(`Registered RSS poll cron "${cronExpr}"`);

    if (this.config.get<boolean>('rss.pollOnBoot')) {
      void this.run('boot');
    }
  }

  private async run(trigger: string): Promise<void> {
    try {
      const result = await this.ingestion.pollAllRssSources();
      this.logger.log(`(${trigger}) inserted ${result.totalInserted} new event(s)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`(${trigger}) RSS poll failed: ${message}`);
    }
  }
}
