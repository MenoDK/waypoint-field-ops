/** Loaded before every e2e file (jest `setupFiles`): configuration for a throw-away PostGIS database. */
const owner = new URL(
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:15450/waypoint',
);
const app = new URL(owner.toString());
app.username = 'app_user';
app.password = 'app_user_test_password';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  MIGRATION_DATABASE_URL: owner.toString(),
  DATABASE_URL: app.toString(),
  APP_DB_PASSWORD: 'app_user_test_password',
  AUTO_MIGRATE: 'false',
  JWT_SECRET: 'test-jwt-secret-test-jwt-secret-1234',
  SIGNED_URL_SECRET: 'test-signed-url-secret-test-signed-url-1234',
  PASSWORD_SCRYPT_LOG2_N: '10', // fast hashing in tests; production enforces >= 14
  AUTH_IP_LIMIT: '100000',
  AUTH_ACCOUNT_LIMIT: '10',
  // The made-up region is ~20 km across: with the production default (30 min) every vehicle in it is always "arriving soon".
  ARRIVING_MINUTES: '5',
});
for (const name of [
  'ROUTER_URL',
  'METRICS_TOKEN',
  'LAB_MODE',
  'DEMO_PASSWORD',
  'FIELD_URL',
  'SITE_DIR',
  'WORKER_HEARTBEAT_FILE',
]) {
  delete process.env[name];
}
