import type { AuthUser } from '../../common/auth';
import type { Clock } from '../../common/clock';
import type { Env } from '../../config/env';
import type { DatabaseService, Tx } from '../../database/database.service';
import type { MetricsService } from '../observability/metrics.service';
import { PingsService } from './pings.service';
import type { PingInput } from './screen';

/**
 * Two batches that overlap (a phone retries and adds a few readings) lock the same rows. If they lock them in different
 * orders, each waits for the other and the database has to kill one: a 500 for a request that was perfectly valid (ADR 0003).
 * A race that depends on timing is a poor test, so this one checks the cause instead: whatever order the phone used, the rows go
 * to the database oldest first. The fake database stops at the insert; nothing after it matters here.
 */
const NOW = new Date('2026-03-01T12:00:00.000Z');
const STOP = new Error('stop at the insert');
const user: AuthUser = { userId: 'u-1', fleetId: 'f-1', role: 'driver' };

const minutesAgo = (minutes: number, over: Partial<PingInput> = {}): PingInput => ({
  lat: 38 + minutes / 1000,
  lng: -98,
  captured_at: new Date(NOW.getTime() - minutes * 60_000).toISOString(),
  source: 'polling',
  ...over,
});

function serviceThatCapturesTheInsert(): { service: PingsService; sent: () => readonly unknown[] } {
  let params: readonly unknown[] = [];
  const tx: Tx = {
    query: ((sql: string, given?: readonly unknown[]) => {
      if (sql.includes('FROM users')) return Promise.resolve({ rows: [{ vehicle_id: 'v-1' }], rowCount: 1 });
      if (sql.includes('INSERT INTO pings')) {
        params = given ?? [];
        return Promise.reject(STOP);
      }
      return Promise.reject(new Error(`unexpected statement: ${sql.slice(0, 40)}`));
    }) as Tx['query'],
  };
  const db = { tx: <T>(fn: (t: Tx) => Promise<T>) => fn(tx) } as unknown as DatabaseService;
  const env = { PING_RETENTION_DAYS: 7, PING_MAX_FUTURE_SKEW_SECONDS: 300 } as Env;
  const clock = { now: () => NOW } as Clock;
  const service = new PingsService(env, db, clock, {} as MetricsService);
  return { service, sent: () => params };
}

describe('PingsService.ingest: the order rows go to the database', () => {
  it.each([
    ['newest first', [1, 2, 3, 4]],
    ['shuffled', [3, 1, 4, 2]],
    ['oldest first', [4, 3, 2, 1]],
  ])('sends the readings oldest first when the phone sent them %s', async (_label, minutes) => {
    const { service, sent } = serviceThatCapturesTheInsert();
    await expect(
      service.ingest(
        user,
        minutes.map((m) => minutesAgo(m)),
      ),
    ).rejects.toBe(STOP);

    const [, , , capturedAt, lat] = sent() as [unknown, unknown, unknown, string[], number[]];
    expect(capturedAt.map((t) => Date.parse(t))).toEqual(
      [...capturedAt.map((t) => Date.parse(t))].sort((a, b) => a - b),
    );
    // ...and every column moved together: the sorting reorders readings, it must never shuffle their fields
    expect(lat).toEqual([...minutes].sort((a, b) => b - a).map((m) => minutesAgo(m).lat));
  });
});
