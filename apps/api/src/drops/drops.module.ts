import { Module } from '@nestjs/common';
import { DropCurrencyRelabelService } from './drop-currency-relabel.service';
import { DropRetractionService } from './drop-retraction.service';
import { DropWatchBackfillService } from './drop-watch-backfill.service';
import { DropWriterService } from './drop-writer.service';

@Module({
  providers: [
    DropWriterService,
    DropRetractionService,
    DropWatchBackfillService,
    DropCurrencyRelabelService,
  ],
  exports: [
    DropWriterService,
    DropRetractionService,
    DropWatchBackfillService,
    DropCurrencyRelabelService,
  ],
})
export class DropsModule {}
