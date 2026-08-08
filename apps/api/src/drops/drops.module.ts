import { Module } from '@nestjs/common';
import { DropRetractionService } from './drop-retraction.service';
import { DropWatchBackfillService } from './drop-watch-backfill.service';
import { DropWriterService } from './drop-writer.service';

@Module({
  providers: [
    DropWriterService,
    DropRetractionService,
    DropWatchBackfillService,
  ],
  exports: [
    DropWriterService,
    DropRetractionService,
    DropWatchBackfillService,
  ],
})
export class DropsModule {}
