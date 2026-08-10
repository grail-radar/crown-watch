import { Module } from '@nestjs/common';
import { AdminGuard } from '../moderation/admin.guard';
import { AlertDispatchService } from './alert-dispatch.service';
import { AlertsController } from './alerts.controller';
import { BroadcastClaimSweepService } from './broadcast-claim-sweep.service';
import { BroadcastPurgeService } from './broadcast-purge.service';
import { HttpTelegramClient, TelegramClient } from './telegram-client';

@Module({
  controllers: [AlertsController],
  providers: [
    AlertDispatchService,
    BroadcastPurgeService,
    BroadcastClaimSweepService,
    AdminGuard,
    { provide: TelegramClient, useClass: HttpTelegramClient },
  ],
  exports: [
    AlertDispatchService,
    BroadcastPurgeService,
    BroadcastClaimSweepService,
  ],
})
export class AlertsModule {}
