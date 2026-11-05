import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { Env } from './config/env';

/** The site's scripts and styles are all same-origin files: nothing inline, nothing from elsewhere, no tiles, no CDN. */
export const SITE_CSP = {
  defaultSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  styleSrc: ["'self'"],
  scriptSrc: ["'self'"],
  connectSrc: ["'self'"],
  baseUri: ["'none'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  objectSrc: ["'none'"],
};

/** One batch of pings is the largest legitimate body; anything much bigger is not a phone. */
export function bodyLimitBytes(env: Env): number {
  return Math.max(64 * 1024, env.PING_MAX_BATCH * 300 + 4096);
}

/**
 * Everything about the HTTP surface that is not a route: headers, body limit, proxy trust, CORS and the static site. Shared by
 * `main.ts` and the end-to-end tests, so the tests exercise the application as it is actually served.
 */
export function configureApp(app: NestExpressApplication, env: Env): void {
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: SITE_CSP },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.useBodyParser('json', { limit: bodyLimitBytes(env) });

  const origins = env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length > 0) app.enableCors({ origin: origins, credentials: false });

  if (env.SITE_DIR) {
    app.useStaticAssets(join(env.SITE_DIR), {
      index: ['index.html'],
      dotfiles: 'ignore',
      maxAge: env.NODE_ENV === 'production' ? '1h' : 0,
    });
  }
}
