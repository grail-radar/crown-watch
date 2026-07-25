import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import configuration from './config/configuration';
import { ProxyThrottlerGuard } from './common/proxy-throttler.guard';
import { PrismaModule } from './prisma/prisma.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { ExtractionModule } from './extraction/extraction.module';
import { CatalogModule } from './catalog/catalog.module';
import { ModerationModule } from './moderation/moderation.module';
import { DigestModule } from './digest/digest.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // Load the app-local env first, fall back to a repo-root .env if present.
      envFilePath: ['.env', '../../.env'],
    }),
    ScheduleModule.forRoot(),
    // Global rate limit: 120 req/min per client IP. Stricter per-route limits
    // are set with @Throttle on the public write endpoints.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
    }),
    PrismaModule,
    IngestionModule,
    ExtractionModule,
    CatalogModule,
    ModerationModule,
    DigestModule,
    SubmissionsModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ProxyThrottlerGuard },
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
  ],
})
export class AppModule {}
