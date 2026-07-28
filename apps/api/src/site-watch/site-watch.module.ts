import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { DropsModule } from '../drops/drops.module';
import { AdminGuard } from '../moderation/admin.guard';
import { RobotsService } from './robots.service';
import { HttpSiteFetcher, SiteFetcher } from './site-fetcher';
import { SiteWatchController } from './site-watch.controller';
import { SiteWatchScheduler } from './site-watch.scheduler';
import { SiteWatchService } from './site-watch.service';

@Module({
  imports: [DropsModule, AlertsModule],
  controllers: [SiteWatchController],
  providers: [
    SiteWatchService,
    SiteWatchScheduler,
    RobotsService,
    AdminGuard,
    { provide: SiteFetcher, useClass: HttpSiteFetcher },
  ],
  exports: [SiteWatchService],
})
export class SiteWatchModule {}
