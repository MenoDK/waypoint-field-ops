import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { ENV, type Env } from '../config/env';

/** The only surface services see inside a transaction: no way to commit, roll back or release by mistake. */
export interface Tx {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // A runaway query or a forgotten transaction must not be able to hold the pool hostage.
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 20_000,
    });
  }

  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(sql, params as unknown[]);
  }

  /** Runs `fn` in one transaction: it commits if `fn` returns and rolls back if it throws. */
  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn({
        query: (sql, params) => client.query(sql, params as unknown[] | undefined),
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* the original error is the one worth reporting */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
