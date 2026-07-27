import { Controller, HttpCode, Post, Query } from '@nestjs/common';
import { SiteWatchService } from './site-watch.service';

@Controller('ingestion/site-watch')
export class SiteWatchController {
  constructor(private readonly siteWatch: SiteWatchService) {}

  /**
   * Poll Tier 4 stores. With `?sourceId=` only that source is polled, which is
   * how a newly added brand gets its baseline without waiting for the cron.
   */
  @Post('poll')
  @HttpCode(200)
  poll(@Query('sourceId') sourceId?: string) {
    return sourceId
      ? this.siteWatch.pollSource(sourceId)
      : this.siteWatch.pollAll();
  }
}
