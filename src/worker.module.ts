import { Module } from '@nestjs/common';
import { ClockModule } from './common/clock';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { IdentityModule } from './modules/identity/identity.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { WorkerLoop } from './worker.loop';

/** The background process: the same services, no HTTP listener, no sockets. */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    ClockModule,
    IdentityModule,
    FleetModule,
    AlertsModule,
    MaintenanceModule,
  ],
  providers: [WorkerLoop],
})
export class WorkerModule {}
