import { Module } from '@nestjs/common';
import { IngestionController } from './ingestion.controller';
import { IngestionScheduler } from './ingestion.scheduler';
import { IngestionService } from './ingestion.service';
import { RssService } from './rss.service';

@Module({
  controllers: [IngestionController],
  providers: [IngestionService, RssService, IngestionScheduler],
  exports: [IngestionService],
})
export class IngestionModule {}
