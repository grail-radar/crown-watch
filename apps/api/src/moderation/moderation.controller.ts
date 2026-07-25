import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { ModerationService } from './moderation.service';

/**
 * Admin-only moderation API. All routes require the `x-admin-token` header
 * (see AdminGuard). Not for public consumption.
 */
@Controller('moderation')
@UseGuards(AdminGuard)
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

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
}
