import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
   *
   * `?release=true` publishes a change big enough to have been refused. It is
   * deliberately per-source and never applies to a whole run: releasing a flood
   * is a decision about one store, taken after looking at that store.
   */
  @Post('poll')
  @HttpCode(200)
  poll(
    @Query('sourceId') sourceId?: string,
    @Query('force') force?: string,
    @Query('release') release?: string,
  ) {
    if (!sourceId) {
      if (release === 'true') {
        // Refusing beats quietly dropping the parameter: an operator who thinks
        // they have released a held store, and has not, learns it here rather
        // than from a channel that stayed silent.
        throw new BadRequestException(
          'release=true needs a sourceId — a held poll is released one store at a time.',
        );
      }
      return this.siteWatch.pollAll();
    }
    return this.siteWatch.pollSource(sourceId, {
      force: force === 'true',
      release: release === 'true',
    });
  }
}
