import { writeFile } from 'node:fs/promises';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ENV, type Env } from './config/env';
import { AlertsService } from './modules/alerts/alerts.service';
import { MaintenanceService } from './modules/maintenance/maintenance.service';

const MAINTENANCE_EVERY_MS = 60 * 60_000;

/**
 * The schedule. Both jobs are idempotent, so there is no leader election: run one worker or three, the result is the same
 * (ADR 0004). A tick that is still running when the next is due is skipped rather than stacked, and a failure is logged and
 * retried on the next tick instead of killing the process.
 */
@Injectable()
export class WorkerLoop implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerLoop.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private lastMaintenance = 0;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(AlertsService) private readonly alerts: AlertsService,
    @Inject(MaintenanceService) private readonly maintenance: MaintenanceService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.env.WORKER_TICK_SECONDS * 1000);
    // Deliberately NOT unref'd: with no HTTP server, this timer is what keeps the process alive.
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (Date.now() - this.lastMaintenance >= MAINTENANCE_EVERY_MS) {
        await this.maintenance.run();
        this.lastMaintenance = Date.now();
      }
      await this.alerts.evaluate();
      if (this.env.WORKER_HEARTBEAT_FILE) await writeFile(this.env.WORKER_HEARTBEAT_FILE, String(Date.now()));
    } catch (error) {
      this.logger.error(`tick failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
