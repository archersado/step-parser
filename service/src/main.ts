import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config, ensureWorkRoot } from './config';

async function bootstrap(): Promise<void> {
  ensureWorkRoot();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  await app.listen(config.port, '0.0.0.0');
  Logger.log(`step2gltf service listening on 0.0.0.0:${config.port}`);
}

void bootstrap();
