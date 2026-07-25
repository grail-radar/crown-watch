import { Module } from '@nestjs/common';
import { AdminGuard } from '../moderation/admin.guard';
import { AnthropicService } from './anthropic.service';
import { ExtractionController } from './extraction.controller';
import { ExtractionService } from './extraction.service';

@Module({
  controllers: [ExtractionController],
  providers: [ExtractionService, AnthropicService, AdminGuard],
  exports: [ExtractionService],
})
export class ExtractionModule {}
