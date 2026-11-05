import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { ClockModule } from './common/clock';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { LabModule } from './lab/lab.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { PingsModule } from './modules/pings/pings.module';
import { QueueModule } from './modules/queue/queue.module';
import { TripsModule } from './modules/trips/trips.module';
import { RealtimeModule } from './realtime/realtime.module';

/** The HTTP + WebSocket application. Every route needs a token and an explicit role unless it is marked @Public(). */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    ClockModule,
    ObservabilityModule,
    IdentityModule,
    FleetModule,
    TripsModule,
    PingsModule,
    AlertsModule,
    QueueModule,
    MaintenanceModule,
    RealtimeModule,
    HealthModule,
    LabModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
