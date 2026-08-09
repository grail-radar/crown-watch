import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { AdminGuard } from './admin.guard';
import { BrandCurationService } from './brand-curation.service';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

@Module({
  imports: [AlertsModule],
  controllers: [ModerationController],
  providers: [ModerationService, BrandCurationService, AdminGuard],
})
export class ModerationModule {}
