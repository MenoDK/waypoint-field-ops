import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';
import type { AuthUser, Role } from '../../common/auth';
import { notFound, unauthorized } from '../../common/errors';
import { RateLimitService } from '../../common/rate-limit.service';
import { ENV, type Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { hashPassword, needsRehash, verifyPassword } from './password';

const WINDOW_SECONDS = 15 * 60;

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    password: z.string().min(1).max(256),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

export interface Session {
  access_token: string;
  expires_in: number;
  user: { id: string; name: string; role: Role; fleet_id: string };
}

@Injectable()
export class IdentityService {
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  async login(input: LoginInput, ip: string): Promise<Session> {
    // Two limiters: (account + IP) stops guessing one account without letting a stranger lock the real owner out from
    // elsewhere; the IP-wide one stops spraying many accounts.
    await this.limits.hit(`login:ip:${ip}`, this.env.AUTH_IP_LIMIT, WINDOW_SECONDS);
    await this.limits.hit(`login:acct:${input.email}:${ip}`, this.env.AUTH_ACCOUNT_LIMIT, WINDOW_SECONDS);

    const { rows } = await this.db.query<{
      id: string;
      fleet_id: string;
      name: string;
      role: Role;
      password_hash: string;
    }>('SELECT id, fleet_id, name, role, password_hash FROM users WHERE email = $1', [input.email]);
    const user = rows[0];
    // Always spend the same scrypt time, whether or not the account exists: the response time must not reveal which
    // e-mail addresses are registered.
    const verified = await verifyPassword(input.password, user?.password_hash ?? (await this.getDummyHash()));
    if (!user || !verified) throw unauthorized('INVALID_CREDENTIALS', 'Invalid e-mail or password');

    if (needsRehash(user.password_hash, this.env.PASSWORD_SCRYPT_LOG2_N)) {
      const upgraded = await hashPassword(input.password, this.env.PASSWORD_SCRYPT_LOG2_N);
      await this.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, upgraded]);
    }
    return this.session({ id: user.id, name: user.name, role: user.role, fleet_id: user.fleet_id });
  }

  /** Mints a token for an existing user. Used by the login above and by the lab's "sign in as" buttons -- nothing else. */
  async session(user: Session['user']): Promise<Session> {
    const access_token = await this.jwt.signAsync({ sub: user.id, fid: user.fleet_id, role: user.role });
    return { access_token, expires_in: this.env.ACCESS_TOKEN_TTL_SECONDS, user };
  }

  async me(auth: AuthUser): Promise<Session['user'] & { email: string; fleet_name: string }> {
    const { rows } = await this.db.query<{
      id: string;
      name: string;
      role: Role;
      fleet_id: string;
      email: string;
      fleet_name: string;
    }>(
      `SELECT u.id, u.name, u.role, u.fleet_id, u.email, f.name AS fleet_name
         FROM users u JOIN fleets f ON f.id = u.fleet_id WHERE u.id = $1 AND u.fleet_id = $2`,
      [auth.userId, auth.fleetId],
    );
    const row = rows[0];
    if (!row) throw notFound('User');
    return row;
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword('not-a-real-password', this.env.PASSWORD_SCRYPT_LOG2_N);
    return this.dummyHash;
  }
}
