import { Module } from '@nestjs/common';
import { AdminGuard } from '../moderation/admin.guard';
import { AlertDispatchService } from './alert-dispatch.service';
import { AlertsController } from './alerts.controller';
import { HttpTelegramClient, TelegramClient } from './telegram-client';

@Module({
  controllers: [AlertsController],
  providers: [
    AlertDispatchService,
    AdminGuard,
    { provide: TelegramClient, useClass: HttpTelegramClient },
  ],
  exports: [AlertDispatchService],
})
export class AlertsModule {}
