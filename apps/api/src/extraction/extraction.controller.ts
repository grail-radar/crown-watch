import { Controller, HttpCode, Post, Query } from '@nestjs/common';
import { ExtractionService } from './extraction.service';

@Controller('extraction')
export class ExtractionController {
  constructor(private readonly extraction: ExtractionService) {}

  /**
   * Run the extraction stage over unprocessed raw_ingestion_events.
   * Optional ?limit=N overrides the batch size.
   */
  @Post('run')
  @HttpCode(200)
  run(@Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : undefined;
    return this.extraction.runExtraction(
      parsed && !Number.isNaN(parsed) ? parsed : undefined,
    );
  }
}
