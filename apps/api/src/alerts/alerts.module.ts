import { Module } from '@nestjs/common';
import { AlertDispatchService } from './alert-dispatch.service';
import { HttpTelegramClient, TelegramClient } from './telegram-client';

@Module({
  providers: [
    AlertDispatchService,
    { provide: TelegramClient, useClass: HttpTelegramClient },
  ],
  exports: [AlertDispatchService],
})
export class AlertsModule {}
