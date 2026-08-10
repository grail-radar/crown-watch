import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { ExtractionModule } from '../extraction/extraction.module';
import { SiteWatchModule } from '../site-watch/site-watch.module';
import { AdminGuard } from './admin.guard';
import { AnnotationDraftService } from './annotation-draft.service';
import { BrandCurationService } from './brand-curation.service';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

@Module({
  imports: [AlertsModule, ExtractionModule, SiteWatchModule],
  controllers: [ModerationController],
  providers: [
    ModerationService,
    BrandCurationService,
    AnnotationDraftService,
    AdminGuard,
  ],
  exports: [AnnotationDraftService],
})
export class ModerationModule {}
