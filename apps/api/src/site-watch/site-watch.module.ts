import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { DropsModule } from '../drops/drops.module';
import { AdminGuard } from '../moderation/admin.guard';
import { LinkProbe } from './link-probe';
import { RobotsService } from './robots.service';
import { HttpSiteFetcher, SiteFetcher } from './site-fetcher';
import { SiteWatchController } from './site-watch.controller';
import { SiteWatchScheduler } from './site-watch.scheduler';
import { SiteWatchService } from './site-watch.service';
import { StoreProbe } from './store-probe';
import { WatchKindBackfillService } from './watch-kind-backfill.service';
import { WatchWriterService } from './watch-writer.service';

@Module({
  imports: [DropsModule, AlertsModule],
  controllers: [SiteWatchController],
  providers: [
    SiteWatchService,
    SiteWatchScheduler,
    WatchWriterService,
    WatchKindBackfillService,
    RobotsService,
    LinkProbe,
    StoreProbe,
    AdminGuard,
    { provide: SiteFetcher, useClass: HttpSiteFetcher },
  ],
  // RobotsService and the fetch seam are exported so the Annotation drafting
  // in `moderation/` reads a brand's own site through the same politeness
  // rules a poll does, rather than growing a second fetcher of its own.
  exports: [
    SiteWatchService,
    StoreProbe,
    WatchKindBackfillService,
    RobotsService,
    SiteFetcher,
  ],
})
export class SiteWatchModule {}
