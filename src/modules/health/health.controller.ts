import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Header, Inject, Optional, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { type AuthedRequest, Public } from '../../common/auth';
import { notFound, unauthorized } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { BusListener } from '../../realtime/bus.listener';
import { RoutingService } from '../../routing/routing.service';
import { MaintenanceService } from '../maintenance/maintenance.service';
import { MetricsService } from '../observability/metrics.service';

@Controller()
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(MaintenanceService) private readonly maintenance: MaintenanceService,
    @Inject(RoutingService) private readonly routing: RoutingService,
    @Optional() @Inject(BusListener) private readonly bus?: BusListener,
  ) {}

  /** Liveness: the process is up. Must not depend on anything external, or a database blip restarts every container. */
  @Public()
  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  /**
   * Readiness: can this instance do its job right now? Besides the database, two things silently break this system if they
   * go unnoticed: no partition for tomorrow (every ping would fail at midnight) and a dead real-time listener (screens would
   * stop updating while every request still returns 200). The router is reported but never fails readiness: ETAs degrade
   * to straight lines, on purpose.
   */
  @Public()
  @Get('health/ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const database = await this.db.ping();
    const ahead = database ? await this.maintenance.partitionsAhead().catch(() => -1) : -1;
    const checks = {
      database: database ? 'up' : 'down',
      partitions_ahead_days: ahead,
      realtime: this.bus ? (this.bus.isListening() ? 'up' : 'down') : 'not_applicable',
      router: this.routing.status(),
    };
    const ready = database && ahead >= 1 && checks.realtime !== 'down';
    // Same body either way: a probe only needs the status code, a person reading the response needs to see WHICH check failed.
    if (!ready) res.status(503);
    return { status: ready ? 'ok' : 'unavailable', checks };
  }

  @Public()
  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  async scrape(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const expected = this.env.METRICS_TOKEN;
    if (!expected) {
      if (this.env.NODE_ENV === 'production') throw notFound('Route');
    } else {
      const given = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer /, ''));
      const want = Buffer.from(expected);
      if (given.length !== want.length || !timingSafeEqual(given, want))
        throw unauthorized('INVALID_TOKEN', 'Invalid metrics token');
    }
    res.type(this.metrics.registry.contentType); // text, not HTML: set here so that the error envelopes above stay JSON
    return this.metrics.registry.metrics();
  }
}
