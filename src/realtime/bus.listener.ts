import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
import { ENV, type Env } from '../config/env';
import { busMessageSchema, CHANNEL } from './events';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Listens on the database's NOTIFY channel and hands every message to the socket gateway.
 *
 * Why the database and not the process: the API that holds the sockets is not the process that decides things. The worker
 * opens alerts, other API replicas ingest positions. NOTIFY reaches every listener, so each replica delivers to its own
 * sockets with no Redis, no adapter and no sticky routing. The connection is dedicated (a pooled one cannot LISTEN) and is
 * re-established with a growing pause if it drops; messages sent while it was down are not replayed, by design.
 */
@Injectable()
export class BusListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BusListener.name);
  private client: Client | null = null;
  private stopped = false;
  private retry: NodeJS.Timeout | undefined;
  private attempt = 0;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(RealtimeGateway) private readonly gateway: RealtimeGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  isListening(): boolean {
    return this.client !== null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({ connectionString: this.env.DATABASE_URL });
    client.on('notification', (n) => {
      if (n.channel !== CHANNEL || !n.payload) return;
      try {
        this.gateway.deliver(busMessageSchema.parse(JSON.parse(n.payload)));
      } catch (error) {
        this.logger.warn(`ignored a malformed bus message: ${(error as Error).message}`);
      }
    });
    const lost = (error?: Error): void => {
      if (this.client !== client) return;
      this.client = null;
      client.removeAllListeners();
      client.end().catch(() => undefined);
      if (error) this.logger.warn(`bus connection lost: ${error.message}`);
      this.schedule();
    };
    client.on('error', lost);
    client.on('end', () => lost());
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      this.client = client;
      this.attempt = 0;
    } catch (error) {
      client.removeAllListeners();
      client.end().catch(() => undefined);
      this.logger.warn(`bus connection failed: ${(error as Error).message}`);
      this.schedule();
    }
  }

  private schedule(): void {
    if (this.stopped) return;
    this.attempt += 1;
    const pause = Math.min(10_000, 250 * 2 ** Math.min(this.attempt, 6));
    this.retry = setTimeout(() => void this.connect(), pause);
    this.retry.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners();
      await client.end().catch(() => undefined);
    }
  }
}
