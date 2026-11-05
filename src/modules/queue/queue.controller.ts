import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type AuthUser, CurrentUser, DISPATCHER, Roles } from '../../common/auth';
import { ZodPipe } from '../../common/zod.pipe';
import { callNextSchema, createUnitSchema, type JoinInput, joinSchema, QueueService } from './queue.service';

@Controller('v1')
export class QueueController {
  constructor(@Inject(QueueService) private readonly queue: QueueService) {}

  @Post('units')
  @Roles(...DISPATCHER)
  createUnit(
    @Body(new ZodPipe(createUnitSchema)) body: { name: string; capacity: number | null },
    @CurrentUser() user: AuthUser,
  ) {
    return this.queue.createUnit(user, body);
  }

  @Get('units/:id/board')
  @Roles(...DISPATCHER)
  board(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.queue.board(user, id);
  }

  @Post('units/:id/tickets')
  @HttpCode(200)
  @Roles(...DISPATCHER)
  join(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(joinSchema)) body: JoinInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.queue.join(user, id, body);
  }

  @Post('units/:id/call-next')
  @HttpCode(200)
  @Roles(...DISPATCHER)
  callNext(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(callNextSchema)) body: { count: number },
    @CurrentUser() user: AuthUser,
  ) {
    return this.queue.callNext(user, id, body.count);
  }

  @Post('tickets/:id/call')
  @HttpCode(200)
  @Roles(...DISPATCHER)
  call(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.queue.callTicket(user, id);
  }

  @Post('tickets/:id/serve')
  @HttpCode(200)
  @Roles(...DISPATCHER)
  serve(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.queue.serve(user, id);
  }

  @Post('tickets/:id/finish')
  @HttpCode(200)
  @Roles(...DISPATCHER)
  finish(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.queue.finish(user, id);
  }

  @Post('tickets/:id/cancel')
  @HttpCode(200)
  @Roles(...DISPATCHER)
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.queue.cancel(user, id);
  }
}
