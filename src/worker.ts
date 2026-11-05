import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JsonLogger } from './common/json-logger';
import { ENV, type Env } from './config/env';
import { WorkerModule } from './worker.module';

/** The background process. It never migrates: the API (or the one-shot migrate service) owns the schema. */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);
  app.useLogger(new JsonLogger(env.LOG_LEVEL));
  app.enableShutdownHooks();
  new Logger('Worker').log(`worker running, tick every ${env.WORKER_TICK_SECONDS}s`);
  // Nothing else holds the event loop open without an HTTP server: wait for the signal that ends the process.
  const signal = await new Promise<NodeJS.Signals>((resolve) => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  });
  new Logger('Worker').log(`received ${signal}, stopping`);
  await app.close();
}

main().catch((error: unknown) => {
  new Logger('Worker').error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
