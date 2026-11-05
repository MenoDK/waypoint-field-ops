import { z } from 'zod';
import { DEMO_DRIVER_EMAILS } from '../lab/demo-accounts';
import { controlServer, Field } from './field';

/**
 * The field stand-in as a process: simulated phones plus a road-router stand-in, driven by a small control API.
 * Everything here is for the demonstration; nothing in the application depends on it.
 */
const schema = z.object({
  API_URL: z.string().default('http://api:3000'),
  DEMO_PASSWORD: z.string().min(8),
  CONTROL_PORT: z.coerce.number().int().default(9500),
  ROUTER_PORT: z.coerce.number().int().default(9501),
  TICK_MS: z.coerce.number().int().min(100).default(1000),
  TIME_SCALE: z.coerce.number().min(1).max(60).default(1),
  FIELD_DRIVERS: z.string().default(''),
});

async function main(): Promise<void> {
  const env = schema.parse(process.env);
  const drivers = env.FIELD_DRIVERS
    ? env.FIELD_DRIVERS.split(',').map((d) => d.trim())
    : [...DEMO_DRIVER_EMAILS];
  const field = new Field({
    apiUrl: env.API_URL,
    password: env.DEMO_PASSWORD,
    drivers,
    phone: { tickMs: env.TICK_MS, timeScale: env.TIME_SCALE },
  });
  await field.router.listen(env.ROUTER_PORT, '0.0.0.0');
  const control = controlServer(field);
  await new Promise<void>((resolve) => control.listen(env.CONTROL_PORT, '0.0.0.0', resolve));
  field.start();
  console.log(
    `field: ${drivers.length} phones, router on :${env.ROUTER_PORT}, control on :${env.CONTROL_PORT}`,
  );

  const stop = (): void => {
    void field.stop().then(() => {
      control.close();
      process.exit(0);
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
