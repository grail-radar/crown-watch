import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { DropsModule } from '../drops/drops.module';
import { AdminGuard } from '../moderation/admin.guard';
import { RobotsService } from './robots.service';
import { HttpSiteFetcher, SiteFetcher } from './site-fetcher';
import { SiteWatchController } from './site-watch.controller';
import { SiteWatchScheduler } from './site-watch.scheduler';
import { SiteWatchService } from './site-watch.service';
import { StoreProbe } from './store-probe';
import { WatchWriterService } from './watch-writer.service';

@Module({
  imports: [DropsModule, AlertsModule],
  controllers: [SiteWatchController],
  providers: [
    SiteWatchService,
    SiteWatchScheduler,
    WatchWriterService,
    RobotsService,
    StoreProbe,
    AdminGuard,
    { provide: SiteFetcher, useClass: HttpSiteFetcher },
  ],
  exports: [SiteWatchService, StoreProbe],
})
export class SiteWatchModule {}
