import { Inject, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { userFromClaims } from '../common/guards';
import { type BusMessage, DRIVER_EVENTS, driverRoom, fleetRoom } from './events';

/**
 * Isolation between fleets is structural, not checked: the room a socket joins is derived from the VERIFIED token at
 * connect time, and the gateway handles no "join" or "subscribe" message at all, so a client has no way to name another
 * fleet's room. A dispatcher joins their fleet; a driver joins only their own room, so a driver's phone never receives the
 * positions of the rest of the fleet.
 */
@WebSocketGateway({ path: '/socket.io', transports: ['websocket', 'polling'] })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly expiry = new Map<string, NodeJS.Timeout>();

  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = (client.handshake.auth as { token?: unknown } | undefined)?.token;
      if (typeof token !== 'string') throw new Error('missing token');
      const claims = await this.jwt.verifyAsync<{ sub: string; fid: string; role: string; exp: number }>(
        token,
        {
          algorithms: ['HS256'],
        },
      );
      const user = userFromClaims(claims);
      await client.join(user.role === 'dispatcher' ? fleetRoom(user.fleetId) : driverRoom(user.userId));
      // A socket outlives the request that authenticated it: cut it when the access token expires.
      const timer = setTimeout(() => client.disconnect(true), Math.max(0, claims.exp * 1000 - Date.now()));
      timer.unref();
      this.expiry.set(client.id, timer);
    } catch {
      client.emit('error', { code: 'UNAUTHORIZED' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const timer = this.expiry.get(client.id);
    if (timer) clearTimeout(timer);
    this.expiry.delete(client.id);
  }

  /** Called by the bus listener for every message the database announced. */
  deliver(message: BusMessage): void {
    if (!this.server) return;
    this.server.to(fleetRoom(message.fleetId)).emit(message.event, message.payload);
    if (message.driverId && DRIVER_EVENTS.has(message.event)) {
      this.server.to(driverRoom(message.driverId)).emit(message.event, message.payload);
    }
    this.logger.debug(`delivered ${message.event} to ${fleetRoom(message.fleetId)}`);
  }
}
