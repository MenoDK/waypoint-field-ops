import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { JsonLogger } from './common/json-logger';
import { parseEnv } from './config/env';
import { DatabaseService } from './database/database.service';
import { migrate } from './database/migrator';
import { seedDemoLocked } from './lab/seed';

async function main(): Promise<void> {
  // Validate the configuration before anything else: a bad setting stops the process here, naming the setting.
  const env = parseEnv(process.env);

  if (env.AUTO_MIGRATE) {
    // parseEnv has already refused AUTO_MIGRATE without these two.
    const applied = await migrate({
      ownerUrl: env.MIGRATION_DATABASE_URL as string,
      appRolePassword: env.APP_DB_PASSWORD as string,
    });
    if (applied.length) new Logger('Bootstrap').log(`applied ${applied.length} migration(s)`);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(new JsonLogger(env.LOG_LEVEL));
  configureApp(app, env);
  app.enableShutdownHooks();

  if (env.LAB_MODE && env.DEMO_PASSWORD) {
    // Only ever in the lab (the configuration refuses LAB_MODE in production): the demonstration's fleets, once.
    const created = await seedDemoLocked(
      app.get(DatabaseService),
      env.DEMO_PASSWORD,
      env.PASSWORD_SCRYPT_LOG2_N,
    );
    new Logger('Bootstrap').log(
      created ? 'demonstration data created' : 'demonstration data already present',
    );
  }

  await app.listen(env.PORT, '0.0.0.0');
  new Logger('Bootstrap').log(`listening on :${env.PORT}${env.LAB_MODE ? ' (lab mode)' : ''}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
