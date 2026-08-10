import { Module } from '@nestjs/common';
import { DropsModule } from '../drops/drops.module';
import { AdminGuard } from '../moderation/admin.guard';
import { AnnotationDraftService } from './annotation-draft.service';
import { AnthropicService } from './anthropic.service';
import { ExtractionController } from './extraction.controller';
import { ExtractionService } from './extraction.service';

@Module({
  imports: [DropsModule],
  controllers: [ExtractionController],
  providers: [
    ExtractionService,
    AnnotationDraftService,
    AnthropicService,
    AdminGuard,
  ],
  exports: [ExtractionService, AnnotationDraftService],
})
export class ExtractionModule {}
