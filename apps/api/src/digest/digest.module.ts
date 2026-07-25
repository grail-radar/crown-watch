import { Module } from '@nestjs/common';
import { AdminGuard } from '../moderation/admin.guard';
import { DigestSenderService } from './digest-sender.service';
import { DigestController } from './digest.controller';
import { DigestService } from './digest.service';

@Module({
  controllers: [DigestController],
  providers: [DigestService, DigestSenderService, AdminGuard],
})
export class DigestModule {}
