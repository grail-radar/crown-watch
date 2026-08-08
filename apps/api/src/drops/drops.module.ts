import { Module } from '@nestjs/common';
import { DropRetractionService } from './drop-retraction.service';
import { DropWriterService } from './drop-writer.service';

@Module({
  providers: [DropWriterService, DropRetractionService],
  exports: [DropWriterService, DropRetractionService],
})
export class DropsModule {}
