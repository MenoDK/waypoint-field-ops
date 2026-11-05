import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export const ROLES = ['dispatcher', 'driver'] as const;
export type Role = (typeof ROLES)[number];

/** What the verified access token says about the caller. The fleet ALWAYS comes from here, never from a request body. */
export interface AuthUser {
  userId: string;
  fleetId: string;
  role: Role;
}

export type AuthedRequest = Request & { user?: AuthUser; id?: string };

export const IS_PUBLIC = 'auth:public';
export const ROLES_KEY = 'auth:roles';

/** Opt a route OUT of authentication. Rare, and always visible in review. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Every protected route must say who may call it. There is no default: a route without @Roles() is refused
 * (see RolesGuard) and a test fails the build if one exists.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route that is not authenticated');
  return user;
});

export const DISPATCHER: Role[] = ['dispatcher'];
export const DRIVER: Role[] = ['driver'];
export const ANY_ROLE: Role[] = [...ROLES];
