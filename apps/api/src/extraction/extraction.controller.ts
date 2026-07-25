import { Controller, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../moderation/admin.guard';
import { ExtractionService } from './extraction.service';

@Controller('extraction')
export class ExtractionController {
  constructor(private readonly extraction: ExtractionService) {}

  /** Admin: fill missing brand metadata (country / website / founded year). */
  @Post('enrich-brands')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  enrichBrands(@Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : undefined;
    return this.extraction.enrichBrands(
      parsed && !Number.isNaN(parsed) ? parsed : 40,
    );
  }

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
