import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { DropsModule } from '../drops/drops.module';
import { AdminGuard } from '../moderation/admin.guard';
import { HttpSiteFetcher, SiteFetcher } from './site-fetcher';
import { SiteWatchController } from './site-watch.controller';
import { SiteWatchService } from './site-watch.service';

@Module({
  imports: [DropsModule, AlertsModule],
  controllers: [SiteWatchController],
  providers: [
    SiteWatchService,
    AdminGuard,
    { provide: SiteFetcher, useClass: HttpSiteFetcher },
  ],
  exports: [SiteWatchService],
})
export class SiteWatchModule {}
