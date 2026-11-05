import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { type AuthedRequest } from '../common/auth';
import { AppException, notFound } from '../common/errors';
import { ENV, type Env } from '../config/env';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const hostOf = (value: string): string => {
  const lower = value.toLowerCase();
  return lower.startsWith('[') ? lower.slice(0, lower.indexOf(']') + 1) : (lower.split(':')[0] ?? '');
};

/**
 * The lab has no login, so the guard has to be strict about where it answers (ADR 0008):
 *  - off unless LAB_MODE is set (and the configuration refuses LAB_MODE in production), and then a plain 404;
 *  - only for a Host header of localhost or a loopback address, so a lab left running on a reachable machine still does not
 *    answer to a name an attacker controls (a DNS-rebinding page is refused with 421);
 *  - a request that changes something must come from a page on that same local host (403 otherwise), which stops an
 *    unrelated web page from firing the lab's buttons at a developer's browser.
 */
@Injectable()
export class LabGate implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.env.LAB_MODE) throw notFound('Route');
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    if (!LOCAL_HOSTS.has(hostOf(request.headers.host ?? ''))) {
      throw new AppException(421, 'MISDIRECTED_REQUEST', 'The lab only answers on localhost');
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.origin;
      if (origin !== undefined) {
        let originHost = '';
        try {
          originHost = hostOf(new URL(origin).host);
        } catch {
          /* an unparseable Origin is refused below */
        }
        if (!LOCAL_HOSTS.has(originHost))
          throw new AppException(403, 'FOREIGN_ORIGIN', 'The lab only takes orders from its own page');
      }
    }
    return true;
  }
}
