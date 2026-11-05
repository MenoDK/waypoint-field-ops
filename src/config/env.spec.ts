import { parseEnv, parseMigrationEnv } from './env';

/** The smallest valid production configuration. Secrets are assembled here, at run time. */
const secret = (label: string): string => `${label}-`.padEnd(40, 'k');
const production = (over: Record<string, string> = {}): Record<string, string> => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://app_user:pw@db:5432/waypoint',
  MIGRATION_DATABASE_URL: 'postgres://owner:pw@db:5432/waypoint',
  APP_DB_PASSWORD: secret('db'),
  JWT_SECRET: secret('jwt'),
  SIGNED_URL_SECRET: secret('sig'),
  ...over,
});

describe('configuration', () => {
  it('accepts a complete production configuration and fills the documented defaults', () => {
    const env = parseEnv(production());
    expect(env).toMatchObject({
      NODE_ENV: 'production',
      NO_SIGNAL_MINUTES: 15,
      LONG_STOP_MINUTES: 30,
      ARRIVAL_CONFIRMATIONS: 2,
      PING_RETENTION_DAYS: 7,
      LAB_MODE: false,
    });
  });

  describe('the schema owner credential', () => {
    const withoutOwner = (): Record<string, string> => {
      const { MIGRATION_DATABASE_URL: _url, APP_DB_PASSWORD: _password, ...rest } = production();
      return rest;
    };

    it('is not needed by the API or the worker: they run on the unprivileged role alone', () => {
      const env = parseEnv(withoutOwner());
      expect(env.MIGRATION_DATABASE_URL).toBeUndefined();
      expect(env.APP_DB_PASSWORD).toBeUndefined();
      expect(env.AUTO_MIGRATE).toBe(false);
    });

    it('is required the moment the process is asked to migrate at start-up', () => {
      expect(() => parseEnv({ ...withoutOwner(), AUTO_MIGRATE: 'true' })).toThrow(
        /AUTO_MIGRATE needs MIGRATION_DATABASE_URL and APP_DB_PASSWORD/,
      );
      expect(parseEnv({ ...production(), AUTO_MIGRATE: 'true' }).AUTO_MIGRATE).toBe(true);
    });

    it('is not accepted as a short password for the application role', () => {
      expect(() => parseEnv(production({ APP_DB_PASSWORD: 'short' }))).toThrow(/APP_DB_PASSWORD/);
    });

    it('is all the migration job asks for: it is given no signing key and no application connection', () => {
      const env = parseMigrationEnv({
        MIGRATION_DATABASE_URL: 'postgres://owner:pw@db:5432/waypoint',
        APP_DB_PASSWORD: secret('db'),
      });
      expect(Object.keys(env).sort()).toEqual(['APP_DB_PASSWORD', 'MIGRATION_DATABASE_URL']);
      expect(() => parseMigrationEnv({ APP_DB_PASSWORD: secret('db') })).toThrow(/MIGRATION_DATABASE_URL/);
      expect(() => parseMigrationEnv({ MIGRATION_DATABASE_URL: 'x' })).toThrow(/APP_DB_PASSWORD/);
    });
  });

  it('names every problem at once, not just the first', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(
      /DATABASE_URL[\s\S]*JWT_SECRET[\s\S]*SIGNED_URL_SECRET/,
    );
  });

  it('refuses a signing key that is too short', () => {
    expect(() => parseEnv(production({ JWT_SECRET: 'short' }))).toThrow(/JWT_SECRET/);
    expect(() => parseEnv(production({ SIGNED_URL_SECRET: 'short' }))).toThrow(/SIGNED_URL_SECRET/);
  });

  it('treats an empty value as unset, which is how Compose passes a variable that has no value', () => {
    const env = parseEnv(production({ ROUTER_URL: '', METRICS_TOKEN: '', DEMO_PASSWORD: '' }));
    expect(env.ROUTER_URL).toBeUndefined();
    expect(env.METRICS_TOKEN).toBeUndefined();
  });

  describe('production refuses what must never be on in production', () => {
    it('the lab', () => {
      expect(() => parseEnv(production({ LAB_MODE: 'true', DEMO_PASSWORD: 'Demo-password-0000' }))).toThrow(
        /LAB_MODE must not be enabled in production/,
      );
    });

    it('a demonstration password, even with the lab off', () => {
      expect(() => parseEnv(production({ DEMO_PASSWORD: 'Demo-password-0000' }))).toThrow(
        /DEMO_PASSWORD must not be set in production/,
      );
    });

    it('a cheap password hash', () => {
      expect(() => parseEnv(production({ PASSWORD_SCRYPT_LOG2_N: '10' }))).toThrow(
        /PASSWORD_SCRYPT_LOG2_N must be at least 14/,
      );
      expect(parseEnv(production({ PASSWORD_SCRYPT_LOG2_N: '14' })).PASSWORD_SCRYPT_LOG2_N).toBe(14);
    });
  });

  describe('outside production', () => {
    it('lets the lab run, but only with a demonstration password to sign in with', () => {
      const base = { ...production({ NODE_ENV: 'development', PASSWORD_SCRYPT_LOG2_N: '10' }) };
      expect(() => parseEnv({ ...base, LAB_MODE: 'true' })).toThrow(/LAB_MODE needs DEMO_PASSWORD/);
      expect(parseEnv({ ...base, LAB_MODE: 'true', DEMO_PASSWORD: 'Demo-password-0000' }).LAB_MODE).toBe(
        true,
      );
    });
  });

  it('keeps the thresholds inside sane bounds', () => {
    expect(() => parseEnv(production({ NO_SIGNAL_MINUTES: '0' }))).toThrow(/NO_SIGNAL_MINUTES/);
    expect(() => parseEnv(production({ ARRIVAL_CONFIRMATIONS: '0' }))).toThrow(/ARRIVAL_CONFIRMATIONS/);
    expect(() => parseEnv(production({ PING_RETENTION_DAYS: '1000' }))).toThrow(/PING_RETENTION_DAYS/);
    expect(() => parseEnv(production({ ACCURACY_LIMIT_M: 'wide' }))).toThrow(/ACCURACY_LIMIT_M/);
  });
});
