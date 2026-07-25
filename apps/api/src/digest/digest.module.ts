import { Module } from '@nestjs/common';
import { DigestController } from './digest.controller';
import { DigestService } from './digest.service';

@Module({
  controllers: [DigestController],
  providers: [DigestService],
})
export class DigestModule {}
