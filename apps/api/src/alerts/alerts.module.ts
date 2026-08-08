import { Module } from '@nestjs/common';
import { AdminGuard } from '../moderation/admin.guard';
import { AlertDispatchService } from './alert-dispatch.service';
import { AlertsController } from './alerts.controller';
import { BroadcastPurgeService } from './broadcast-purge.service';
import { HttpTelegramClient, TelegramClient } from './telegram-client';

@Module({
  controllers: [AlertsController],
  providers: [
    AlertDispatchService,
    BroadcastPurgeService,
    AdminGuard,
    { provide: TelegramClient, useClass: HttpTelegramClient },
  ],
  exports: [AlertDispatchService, BroadcastPurgeService],
})
export class AlertsModule {}
