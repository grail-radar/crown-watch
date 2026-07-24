import { Controller, HttpCode, Post } from '@nestjs/common';
import { IngestionService } from './ingestion.service';

@Controller('ingestion')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  /**
   * Manually trigger a Tier 1 RSS poll across all configured sources.
   * Useful in dev and before the BullMQ scheduler is wired up (CONTEXT.md §3).
   */
  @Post('rss/poll')
  @HttpCode(200)
  pollRss() {
    return this.ingestion.pollAllRssSources();
  }
}
