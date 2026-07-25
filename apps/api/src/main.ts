import './instrument'; // Sentry — must be first
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  // Behind Render's proxy — needed so rate limiting sees real client IPs.
  app.set('trust proxy', 1);

  const config = app.get(ConfigService);
  const webOrigin = config.get<string>('webOrigin');
  app.enableCors({
    origin: webOrigin ? webOrigin.split(',').map((o) => o.trim()) : true,
  });

  const port = config.get<number>('port') ?? 3333;
  // Bind 0.0.0.0 so the app is reachable inside a container (Render/Fly inject $PORT).
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`crown-watch API listening on port ${port}`);
}

void bootstrap();
