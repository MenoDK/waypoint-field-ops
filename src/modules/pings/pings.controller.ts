import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { type AuthUser, CurrentUser, DRIVER, Roles } from '../../common/auth';
import { ZodPipe } from '../../common/zod.pipe';
import { ENV, type Env } from '../../config/env';
import { PingsService } from './pings.service';
import { batchSchema, type PingInput } from './screen';

@Controller('v1')
export class PingsController {
  private readonly pipe: ZodPipe<ReturnType<typeof batchSchema>>;

  constructor(
    @Inject(PingsService) private readonly pings: PingsService,
    @Inject(ENV) env: Env,
  ) {
    this.pipe = new ZodPipe(batchSchema(env.PING_MAX_BATCH));
  }

  /**
   * One or many readings from the calling driver's phone. The driver, fleet and vehicle come from the token and the
   * database, never from the body: a phone cannot report a position on someone else's behalf (the schema is strict, so
   * even a `driver_id` field is refused).
   */
  @Post('pings')
  @HttpCode(200)
  @Roles(...DRIVER)
  ingest(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = this.pipe.transform(body) as { pings: PingInput[] };
    return this.pings.ingest(user, parsed.pings);
  }
}
