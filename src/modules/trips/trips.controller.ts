import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ANY_ROLE, type AuthUser, CurrentUser, DISPATCHER, DRIVER, Public, Roles } from '../../common/auth';
import { badRequest } from '../../common/errors';
import { ZodPipe } from '../../common/zod.pipe';
import { SheetService } from './sheet.service';
import type { TripStatus } from './trip-state';
import {
  completeTripSchema,
  type CreateTripInput,
  createTripSchema,
  noteSchema,
  startTripSchema,
  TripsService,
} from './trips.service';

const STATUSES = ['PLANNED', 'ACCEPTED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'];

@Controller('v1')
export class TripsController {
  constructor(
    @Inject(TripsService) private readonly trips: TripsService,
    @Inject(SheetService) private readonly sheets: SheetService,
  ) {}

  @Post('trips')
  @Roles(...DISPATCHER)
  create(@Body(new ZodPipe(createTripSchema)) body: CreateTripInput, @CurrentUser() user: AuthUser) {
    return this.trips.create(user, body);
  }

  /** A dispatcher sees the fleet's trips; a driver sees their own. The query is the same, the scope comes from the token. */
  @Get('trips')
  @Roles(...ANY_ROLE)
  list(@Query('status') status: string | undefined, @CurrentUser() user: AuthUser) {
    if (status !== undefined && !STATUSES.includes(status))
      throw badRequest('INVALID_STATUS', `status must be one of ${STATUSES.join(', ')}`);
    return this.trips.list(user, status as TripStatus | undefined);
  }

  @Get('trips/:id')
  @Roles(...ANY_ROLE)
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.trips.get(user, id);
  }

  @Get('trips/:id/route')
  @Roles(...ANY_ROLE)
  route(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.trips.route(user, id);
  }

  @Post('trips/:id/accept')
  @HttpCode(200)
  @Roles(...DRIVER)
  accept(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.trips.accept(user, id);
  }

  @Post('trips/:id/start')
  @HttpCode(200)
  @Roles(...DRIVER)
  start(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(startTripSchema)) body: { km_start: number },
    @CurrentUser() user: AuthUser,
  ) {
    return this.trips.start(user, id, body.km_start);
  }

  @Post('trips/:id/complete')
  @HttpCode(200)
  @Roles(...DRIVER)
  complete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(completeTripSchema)) body: { km_end: number },
    @CurrentUser() user: AuthUser,
  ) {
    return this.trips.complete(user, id, body.km_end);
  }

  @Post('trips/:id/cancel')
  @HttpCode(200)
  @Roles(...DISPATCHER)
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.trips.cancel(user, id);
  }

  @Post('trips/:id/notes')
  @HttpCode(200)
  @Roles(...DRIVER)
  note(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(noteSchema)) body: { text: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.trips.addNote(user, id, body.text);
  }

  @Post('trips/:id/sheet-link')
  @HttpCode(200)
  @Roles(...DISPATCHER)
  sheetLink(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.sheets.link(user, id);
  }

  /** Public on purpose: the signed link is the credential. See `signed-url.ts` for exactly what it proves. */
  @Public()
  @Get('trips/:id/sheet.pdf')
  @Header('Cache-Control', 'private, no-store')
  async sheet(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('exp') exp: unknown,
    @Query('sig') sig: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.sheets.render(id, exp, sig);
    // The type is set only once there IS a PDF: an error (bad link, expired) must stay the JSON envelope it is.
    res.type('application/pdf').end(pdf);
  }
}
