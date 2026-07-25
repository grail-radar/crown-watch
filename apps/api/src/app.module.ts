import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { ExtractionModule } from './extraction/extraction.module';
import { CatalogModule } from './catalog/catalog.module';
import { ModerationModule } from './moderation/moderation.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // Load the app-local env first, fall back to a repo-root .env if present.
      envFilePath: ['.env', '../../.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    IngestionModule,
    ExtractionModule,
    CatalogModule,
    ModerationModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
