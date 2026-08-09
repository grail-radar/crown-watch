import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { BrandCurationService } from './brand-curation.service';
import { ModerationService } from './moderation.service';

/**
 * Admin-only moderation API. All routes require the `x-admin-token` header
 * (see AdminGuard). Not for public consumption.
 */
@Controller('moderation')
@UseGuards(AdminGuard)
export class ModerationController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly curation: BrandCurationService,
  ) {}

  @Get('queue')
  queue(@Query('take') take?: string) {
    const n = take ? parseInt(take, 10) : NaN;
    return this.moderation.queue(Number.isNaN(n) ? 50 : n);
  }

  @Post('drops/:id/approve')
  approve(@Param('id') id: string) {
    return this.moderation.approve(id);
  }

  @Post('drops/:id/reject')
  reject(@Param('id') id: string) {
    return this.moderation.reject(id);
  }

  /**
   * Approve an Annotation and curate the Brand.
   *
   * The only route to `curated` there is. It sits behind the admin token
   * because a person deciding is the entire content of the state (ADR-0004:
   * nothing about it is purchasable).
   */
  @Put('brands/:slug/annotation')
  annotate(@Param('slug') slug: string, @Body('annotation') annotation: string) {
    return this.curation.annotate(slug, annotation);
  }

  /** Withdraw the Annotation and return the Brand to Listed. */
  @Delete('brands/:slug/annotation')
  withdrawAnnotation(@Param('slug') slug: string) {
    return this.curation.withdraw(slug);
  }
}
