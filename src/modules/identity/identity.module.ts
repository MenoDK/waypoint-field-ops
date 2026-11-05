import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RateLimitService } from '../../common/rate-limit.service';
import { ENV, type Env } from '../../config/env';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_SECRET,
        signOptions: { algorithm: 'HS256', expiresIn: env.ACCESS_TOKEN_TTL_SECONDS },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [IdentityController],
  providers: [IdentityService, RateLimitService],
  exports: [IdentityService, JwtModule, RateLimitService],
})
export class IdentityModule {}
