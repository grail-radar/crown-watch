import { Module } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

@Module({
  controllers: [ModerationController],
  providers: [ModerationService, AdminGuard],
})
export class ModerationModule {}
