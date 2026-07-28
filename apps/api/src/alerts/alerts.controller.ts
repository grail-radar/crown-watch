import { Controller, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../moderation/admin.guard';
import { AlertDispatchService } from './alert-dispatch.service';

/**
 * Admin-only. This endpoint posts to public channels that cannot unsend, so it
 * is never left open — and it defaults to a dry run even for an authenticated
 * caller.
 */
@Controller('alerts')
@UseGuards(AdminGuard)
export class AlertsController {
  constructor(private readonly alerts: AlertDispatchService) {}

  /**
   * Post published drops that have never reached a channel.
   *
   * Renders and returns the messages without sending; add `?confirm=true` to
   * actually post. `?limit=` caps how many drops one run works through.
   */
  @Post('backfill')
  @HttpCode(200)
  backfill(@Query('confirm') confirm?: string, @Query('limit') limit?: string) {
    const parsed = limit === undefined ? undefined : parseInt(limit, 10);
    return this.alerts.backfill({
      confirm: confirm === 'true',
      limit: Number.isFinite(parsed) ? parsed : undefined,
    });
  }
}
