import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/**
 * All configuration is validated once at startup. A missing or malformed value stops the process with a readable message
 * instead of surfacing later as a confusing runtime error. Every threshold that decides what an operator sees (how long
 * silence is "no signal", how accurate a fix must be) lives here, with a bound, so none of them is a magic number in code.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /** Connection used by the application: the unprivileged `app_user` role. */
  DATABASE_URL: z.string().min(1),
  /**
   * Connection used ONLY to run migrations: the schema owner. The long-running processes do not need it and in the Compose
   * stack do not get it -- only the one-shot `migrate` job does -- so a compromised API holds no credential that can alter
   * the schema.
   */
  MIGRATION_DATABASE_URL: z.string().min(1).optional(),
  /** Password given to `app_user` when the migrator creates the role. */
  APP_DB_PASSWORD: z.string().min(8).optional(),
  /** Migrate at start-up. Off by default; for a single-process development setup. Needs the two settings above. */
  AUTO_MIGRATE: bool.default(false),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  /** log2 of the scrypt cost parameter N. 15 => N = 32768. */
  PASSWORD_SCRYPT_LOG2_N: z.coerce.number().int().min(10).max(20).default(15),
  AUTH_IP_LIMIT: z.coerce.number().int().min(1).default(100),
  AUTH_ACCOUNT_LIMIT: z.coerce.number().int().min(1).default(10),

  /** Key for the signed trip-sheet links. Generate: openssl rand -hex 32 */
  SIGNED_URL_SECRET: z.string().min(32),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),

  /** How long positions are kept. Location is personal data: keep it for as short as the operation allows. */
  PING_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  PING_MAX_BATCH: z.coerce.number().int().min(1).max(2000).default(500),
  /** A capture timestamp further in the future than this is a wrong clock, not a position. */
  PING_MAX_FUTURE_SKEW_SECONDS: z.coerce.number().int().min(0).max(3600).default(300),
  /** A fix worse than this is stored, but never used to decide arrival, speed or stops. */
  ACCURACY_LIMIT_M: z.coerce.number().int().min(5).max(2000).default(100),

  NO_SIGNAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  LONG_STOP_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  ARRIVING_MINUTES: z.coerce.number().int().min(1).max(240).default(30),
  /** Consecutive good fixes inside the geofence needed to call it an arrival (one fix can be GPS jitter). */
  ARRIVAL_CONFIRMATIONS: z.coerce.number().int().min(1).max(10).default(2),
  /** Speed (km/h) above which a vehicle counts as moving. */
  MOVING_KMH: z.coerce.number().min(1).max(30).default(5),
  /** Speed assumed when there is not enough history to measure one. */
  DEFAULT_SPEED_KMH: z.coerce.number().min(10).max(120).default(60),

  /** Optional road router speaking the OSRM route API. Unset: ETAs are straight-line and say so. */
  ROUTER_URL: z.string().min(1).optional(),
  ROUTER_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(2500),

  WORKER_TICK_SECONDS: z.coerce.number().int().min(1).max(3600).default(30),
  /** When set, the worker rewrites this file after every tick that succeeded; the container health check reads its age. */
  WORKER_HEARTBEAT_FILE: z.string().min(1).optional(),

  /** The lab (ADR 0008): levers that run the scheduled jobs on demand and break the stand-ins. Refused in production. */
  LAB_MODE: bool.default(false),
  SITE_DIR: z.string().default(''),
  DEMO_PASSWORD: z.string().min(8).optional(),
  /** Where the field stand-in (phones and road router) takes its orders from; lab only. */
  FIELD_URL: z.string().min(1).optional(),

  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  METRICS_TOKEN: z.string().min(16).optional(),
  CORS_ORIGINS: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

/** What the one-shot migration job needs, and nothing else: it holds no signing key and no application connection. */
const migrationEnvSchema = z.object({
  MIGRATION_DATABASE_URL: z.string().min(1),
  APP_DB_PASSWORD: z.string().min(8),
});

export type MigrationEnv = z.infer<typeof migrationEnvSchema>;

function validate<S extends z.ZodType>(schema: S, source: Record<string, string | undefined>): z.infer<S> {
  // Compose passes an unset variable as an empty string; to the schema that means "not provided".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

export function parseMigrationEnv(source: Record<string, string | undefined>): MigrationEnv {
  return validate(migrationEnvSchema, source);
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const env = validate(envSchema, source);
  if (env.AUTO_MIGRATE && (!env.MIGRATION_DATABASE_URL || !env.APP_DB_PASSWORD)) {
    throw new Error('AUTO_MIGRATE needs MIGRATION_DATABASE_URL and APP_DB_PASSWORD');
  }
  if (env.NODE_ENV === 'production') {
    if (env.LAB_MODE) throw new Error('LAB_MODE must not be enabled in production');
    if (env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD must not be set in production');
    if (env.PASSWORD_SCRYPT_LOG2_N < 14)
      throw new Error('PASSWORD_SCRYPT_LOG2_N must be at least 14 in production');
  }
  if (env.LAB_MODE && !env.DEMO_PASSWORD)
    throw new Error('LAB_MODE needs DEMO_PASSWORD (the lab signs in as the demo users)');
  return env;
}

export const ENV = Symbol('ENV');
