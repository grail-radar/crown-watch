import { Controller, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../moderation/admin.guard';
import { SiteWatchService } from './site-watch.service';

/**
 * Admin-only. Unlike the other ingestion triggers, a site-watch poll publishes
 * straight to the public feed and sends outbound requests to brands' stores, so
 * it is not left open: an anonymous caller could otherwise use us to hammer the
 * very shops the product depends on.
 */
@Controller('ingestion/site-watch')
@UseGuards(AdminGuard)
export class SiteWatchController {
  constructor(private readonly siteWatch: SiteWatchService) {}

  /**
   * Poll Tier 4 stores. With `?sourceId=` only that source is polled, which is
   * how a newly added brand gets its baseline on demand.
   *
   * `?force=true` ignores an active backoff window for that one source — how an
   * operator retries straight after fixing a broken selector, rather than
   * waiting out a window the old configuration earned.
   */
  @Post('poll')
  @HttpCode(200)
  poll(@Query('sourceId') sourceId?: string, @Query('force') force?: string) {
    return sourceId
      ? this.siteWatch.pollSource(sourceId, { force: force === 'true' })
      : this.siteWatch.pollAll();
  }
}
