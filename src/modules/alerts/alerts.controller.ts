import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type AuthUser, CurrentUser, DISPATCHER, Roles } from '../../common/auth';
import { badRequest } from '../../common/errors';
import { AlertsService } from './alerts.service';

@Controller('v1')
export class AlertsController {
  constructor(@Inject(AlertsService) private readonly alerts: AlertsService) {}

  @Get('alerts')
  @Roles(...DISPATCHER)
  list(@Query('status') status: string | undefined, @CurrentUser() user: AuthUser) {
    if (status !== undefined && status !== 'open' && status !== 'cleared') {
      throw badRequest('INVALID_STATUS', 'status must be "open" or "cleared"');
    }
    return this.alerts.list(user, status);
  }
}
