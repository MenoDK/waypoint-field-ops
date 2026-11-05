import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { type AuthedRequest, IS_PUBLIC, type Role, ROLES, ROLES_KEY } from './auth';
import { forbidden, unauthorized } from './errors';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Claims {
  sub?: string;
  fid?: string;
  role?: string;
}

/** Turns verified claims into a caller, or throws. Shared by the HTTP guard and the socket handshake. */
export function userFromClaims(claims: Claims): { userId: string; fleetId: string; role: Role } {
  if (
    !claims.sub ||
    !UUID.test(claims.sub) ||
    !claims.fid ||
    !UUID.test(claims.fid) ||
    !ROLES.includes(claims.role as Role)
  )
    throw new Error('bad claims');
  return { userId: claims.sub, fleetId: claims.fid, role: claims.role as Role };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]))
      return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    try {
      // `algorithms` is pinned: never let the token choose how it is verified ("alg": "none" and friends).
      request.user = userFromClaims(await this.jwt.verifyAsync<Claims>(token, { algorithms: ['HS256'] }));
      return true;
    } catch {
      throw unauthorized('INVALID_TOKEN', 'Invalid or expired token');
    }
  }
}

/** Deny by default: authenticated is not enough, the route must explicitly list the roles it accepts. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (!allowed?.length) throw forbidden('NO_ACCESS_POLICY', 'This endpoint declares no access policy');
    if (!user || !allowed.includes(user.role)) throw forbidden();
    return true;
  }
}
