import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ANY_ROLE, type AuthedRequest, type AuthUser, CurrentUser, Public, Roles } from '../../common/auth';
import { clientIp } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import { IdentityService, type LoginInput, loginSchema } from './identity.service';

@Controller('v1')
export class IdentityController {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Req() req: AuthedRequest) {
    return this.identity.login(body, clientIp(req));
  }

  @Get('me')
  @Roles(...ANY_ROLE)
  me(@CurrentUser() user: AuthUser) {
    return this.identity.me(user);
  }
}
