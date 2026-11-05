import { Global, Module } from '@nestjs/common';
import { RoutingService } from '../../routing/routing.service';
import { EtaService } from './eta.service';
import { FleetController } from './fleet.controller';
import { FleetService } from './fleet.service';

@Global()
@Module({
  controllers: [FleetController],
  providers: [RoutingService, EtaService, FleetService],
  exports: [RoutingService, EtaService, FleetService],
})
export class FleetModule {}
