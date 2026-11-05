import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { type AuthUser, CurrentUser, DISPATCHER, Roles } from '../../common/auth';
import { FleetService } from './fleet.service';

@Controller('v1')
export class FleetController {
  constructor(@Inject(FleetService) private readonly fleet: FleetService) {}

  /** The live map: every driver of the caller's fleet. A reconnecting screen calls this to catch up on what it missed. */
  @Get('fleet/snapshot')
  @Roles(...DISPATCHER)
  snapshot(@CurrentUser() user: AuthUser) {
    return this.fleet.snapshot(user);
  }

  @Get('fleet/catalog')
  @Roles(...DISPATCHER)
  catalog(@CurrentUser() user: AuthUser) {
    return this.fleet.catalog(user);
  }

  @Get('trips/:id/trail')
  @Roles(...DISPATCHER)
  trail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.fleet.trail(user, id);
  }
}
