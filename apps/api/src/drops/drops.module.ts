import { Module } from '@nestjs/common';
import { DropWriterService } from './drop-writer.service';

@Module({
  providers: [DropWriterService],
  exports: [DropWriterService],
})
export class DropsModule {}
