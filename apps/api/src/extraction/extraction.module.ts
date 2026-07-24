import { Module } from '@nestjs/common';
import { AnthropicService } from './anthropic.service';
import { ExtractionController } from './extraction.controller';
import { ExtractionService } from './extraction.service';

@Module({
  controllers: [ExtractionController],
  providers: [ExtractionService, AnthropicService],
  exports: [ExtractionService],
})
export class ExtractionModule {}
