import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AuthUser, Public, Roles } from './auth';
import { AppException } from './errors';
import { RolesGuard } from './guards';

/**
 * Deny by default: a route that says nothing about who may call it is closed, not open. A test that walks every real route already fails the build for a missing declaration; this one checks the guard
 * itself, so the rule still holds on the day someone mounts a route in a way that scan does not see.
 */
const dispatcher: AuthUser = { userId: 'u-1', fleetId: 'f-1', role: 'dispatcher' };

/** A controller whose one handler carries exactly the decorators given, and the context Nest would hand a guard for it. */
function route(decorators: MethodDecorator[], user?: AuthUser): ExecutionContext {
  class Controller {
    handler(): void {}
  }
  const descriptor = Object.getOwnPropertyDescriptor(Controller.prototype, 'handler') as PropertyDescriptor;
  for (const decorate of decorators) decorate(Controller.prototype, 'handler', descriptor);
  return {
    getHandler: () => Controller.prototype.handler,
    getClass: () => Controller,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function refusal(context: ExecutionContext): { status: number; code: string } {
  try {
    new RolesGuard(new Reflector()).canActivate(context);
  } catch (error) {
    if (error instanceof AppException) return { status: error.getStatus(), code: error.code };
    throw error;
  }
  throw new Error('the guard let the request through');
}

describe('RolesGuard', () => {
  it('closes a route that declares no roles at all, even to a signed-in caller', () => {
    expect(refusal(route([], dispatcher))).toEqual({ status: 403, code: 'NO_ACCESS_POLICY' });
  });

  it('closes a route whose list of roles is empty: "nobody listed" is not "everybody"', () => {
    expect(refusal(route([Roles()], dispatcher))).toEqual({ status: 403, code: 'NO_ACCESS_POLICY' });
  });

  it('refuses a caller whose role is not on the list', () => {
    expect(refusal(route([Roles('driver')], dispatcher))).toEqual({ status: 403, code: 'FORBIDDEN' });
  });

  it('refuses a request that carries no caller at all', () => {
    expect(refusal(route([Roles('dispatcher')]))).toEqual({ status: 403, code: 'FORBIDDEN' });
  });

  it('lets a caller in when their role is on the list', () => {
    expect(new RolesGuard(new Reflector()).canActivate(route([Roles('dispatcher')], dispatcher))).toBe(true);
  });

  it('lets a public route in without roles: it opted out of authentication on purpose', () => {
    expect(new RolesGuard(new Reflector()).canActivate(route([Public()]))).toBe(true);
  });
});
