import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth';
import { Clock } from '../../common/clock';
import { conflict, notFound } from '../../common/errors';
import { DatabaseService, type Tx } from '../../database/database.service';
import { EVENTS, publish } from '../../realtime/events';
import { admission, type Plan, planCalls, type QueueState, type WaitingTicket } from './planner';

export const joinSchema = z
  .object({
    person_ref: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/, 'letters, digits, dot, dash and underscore only'),
    service: z.string().regex(/^[a-z0-9_-]{1,40}$/, 'lower-case letters, digits, dash and underscore only'),
    priority: z.boolean().default(false),
  })
  .strict();
export type JoinInput = z.infer<typeof joinSchema>;

export const callNextSchema = z.object({ count: z.number().int().min(1).max(50).default(1) }).strict();
export const createUnitSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    capacity: z.number().int().min(1).max(500).nullable().default(null),
  })
  .strict();

export interface Ticket {
  id: string;
  unit_id: string;
  person_ref: string;
  service: string;
  priority: boolean;
  status: 'waiting' | 'called' | 'serving' | 'done' | 'cancelled';
  created_at: Date;
  called_at: Date | null;
}

const COLUMNS = 'id, unit_id, person_ref, service, priority, status, created_at, called_at';

@Injectable()
export class QueueService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async createUnit(user: AuthUser, input: { name: string; capacity: number | null }) {
    const { rows } = await this.db.query(
      'INSERT INTO units (fleet_id, name, capacity) VALUES ($1, $2, $3) RETURNING id, name, capacity',
      [user.fleetId, input.name, input.capacity],
    );
    return rows[0];
  }

  /** Joining twice for the same service is the same ticket: a double click or a retried request does not queue someone twice. */
  async join(
    user: AuthUser,
    unitId: string,
    input: JoinInput,
  ): Promise<{ ticket: Ticket; already_waiting: boolean }> {
    return this.db.tx(async (tx) => {
      await this.lockUnit(tx, user, unitId);
      const inserted = await tx.query<Ticket>(
        `INSERT INTO tickets (unit_id, fleet_id, person_ref, service, priority) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (unit_id, person_ref, service) WHERE status IN ('waiting', 'called', 'serving') DO NOTHING
         RETURNING ${COLUMNS}`,
        [unitId, user.fleetId, input.person_ref, input.service, input.priority],
      );
      if (inserted.rows[0]) {
        await this.announce(tx, user, unitId);
        return { ticket: inserted.rows[0], already_waiting: false };
      }
      const existing = await tx.query<Ticket>(
        `SELECT ${COLUMNS} FROM tickets WHERE unit_id = $1 AND person_ref = $2 AND service = $3 AND status IN ('waiting', 'called', 'serving')`,
        [unitId, input.person_ref, input.service],
      );
      return { ticket: existing.rows[0] as Ticket, already_waiting: true };
    });
  }

  /**
   * Calls the next people, as many as the plan allows up to `count`. The unit row is locked for the whole decision, so two
   * dispatchers pressing "call next" at the same instant are served one after the other and the second sees the first's
   * result: the ceiling cannot be overshot by a race (ADR 0005).
   */
  async callNext(user: AuthUser, unitId: string, count: number): Promise<Plan & { called: Ticket[] }> {
    return this.db.tx(async (tx) => {
      const capacity = await this.lockUnit(tx, user, unitId);
      const plan = planCalls(await this.state(tx, unitId, capacity));
      const chosen = plan.calls.slice(0, count);
      const called = await this.markCalled(
        tx,
        user,
        unitId,
        chosen.map((c) => c.ticketId),
      );
      if (called.length) await this.announce(tx, user, unitId);
      return { ...plan, calls: chosen, called };
    });
  }

  /** Calls one specific ticket -- through the SAME admission rule as `callNext`, so this entry point cannot bypass the ceiling. */
  async callTicket(user: AuthUser, ticketId: string): Promise<Ticket> {
    return this.db.tx(async (tx) => {
      const ticket = await this.findTicket(tx, user, ticketId);
      const capacity = await this.lockUnit(tx, user, ticket.unit_id);
      const state = await this.state(tx, ticket.unit_id, capacity);
      const verdict = admission(state, ticket.person_ref);
      if (!verdict.allowed) {
        throw conflict(
          'UNIT_FULL',
          `The unit is full: ${verdict.onBoard} of ${verdict.capacity} places are taken`,
          {
            on_board: verdict.onBoard,
            capacity: verdict.capacity,
          },
        );
      }
      const [called] = await this.markCalled(tx, user, ticket.unit_id, [ticketId]);
      if (!called)
        throw conflict('INVALID_STATE', `A ${ticket.status} ticket cannot be called`, {
          current: ticket.status,
        });
      await this.announce(tx, user, ticket.unit_id);
      return called;
    });
  }

  serve(user: AuthUser, ticketId: string) {
    return this.move(user, ticketId, ['called'], 'serving');
  }
  finish(user: AuthUser, ticketId: string) {
    return this.move(user, ticketId, ['serving'], 'done');
  }
  cancel(user: AuthUser, ticketId: string) {
    return this.move(user, ticketId, ['waiting', 'called'], 'cancelled');
  }

  async board(user: AuthUser, unitId: string) {
    const unit = await this.db.query<{ id: string; name: string; capacity: number | null }>(
      'SELECT id, name, capacity FROM units WHERE id = $1 AND fleet_id = $2',
      [unitId, user.fleetId],
    );
    if (!unit.rows[0]) throw notFound('Unit');
    const tickets = await this.db.query<Ticket & { seq: string }>(
      `SELECT ${COLUMNS}, seq FROM tickets WHERE unit_id = $1 AND status IN ('waiting', 'called', 'serving')
        ORDER BY priority DESC, seq`,
      [unitId],
    );
    const onBoard = new Set(tickets.rows.filter((t) => t.status !== 'waiting').map((t) => t.person_ref));
    const plan = planCalls({
      capacity: unit.rows[0].capacity,
      onBoard,
      waiting: tickets.rows.filter((t) => t.status === 'waiting').map((t) => toWaiting(t, Number(t.seq))),
      stationLoad: load(tickets.rows),
    });
    return {
      unit: unit.rows[0],
      on_board: onBoard.size,
      free_places: plan.freeSlots,
      warning: plan.warning,
      tickets: tickets.rows,
    };
  }

  private async move(
    user: AuthUser,
    ticketId: string,
    from: Ticket['status'][],
    to: Ticket['status'],
  ): Promise<Ticket> {
    return this.db.tx(async (tx) => {
      const found = await this.findTicket(tx, user, ticketId);
      const { rows } = await tx.query<Ticket>(
        `UPDATE tickets SET status = $3, finished_at = CASE WHEN $3 IN ('done', 'cancelled') THEN $5::timestamptz ELSE finished_at END
          WHERE id = $1 AND fleet_id = $2 AND status = ANY($4::text[]) RETURNING ${COLUMNS}`,
        [ticketId, user.fleetId, to, from, this.clock.now().toISOString()],
      );
      if (!rows[0])
        throw conflict('INVALID_STATE', `A ${found.status} ticket cannot become ${to}`, {
          current: found.status,
        });
      await this.announce(tx, user, found.unit_id);
      return rows[0];
    });
  }

  /** Takes the unit's row lock and returns its capacity. Also the fleet check: another fleet's unit does not exist here. */
  private async lockUnit(tx: Tx, user: AuthUser, unitId: string): Promise<number | null> {
    const { rows } = await tx.query<{ capacity: number | null }>(
      'SELECT capacity FROM units WHERE id = $1 AND fleet_id = $2 FOR UPDATE',
      [unitId, user.fleetId],
    );
    if (!rows[0]) throw notFound('Unit');
    return rows[0].capacity;
  }

  private async findTicket(tx: Tx, user: AuthUser, ticketId: string): Promise<Ticket> {
    const { rows } = await tx.query<Ticket>(
      `SELECT ${COLUMNS} FROM tickets WHERE id = $1 AND fleet_id = $2`,
      [ticketId, user.fleetId],
    );
    if (!rows[0]) throw notFound('Ticket');
    return rows[0];
  }

  private async state(tx: Tx, unitId: string, capacity: number | null): Promise<QueueState> {
    const { rows } = await tx.query<Ticket & { seq: string }>(
      `SELECT ${COLUMNS}, seq FROM tickets WHERE unit_id = $1 AND status IN ('waiting', 'called', 'serving')`,
      [unitId],
    );
    return {
      capacity,
      onBoard: new Set(rows.filter((t) => t.status !== 'waiting').map((t) => t.person_ref)),
      waiting: rows.filter((t) => t.status === 'waiting').map((t) => toWaiting(t, Number(t.seq))),
      stationLoad: load(rows),
    };
  }

  private async markCalled(tx: Tx, user: AuthUser, unitId: string, ids: string[]): Promise<Ticket[]> {
    if (ids.length === 0) return [];
    const { rows } = await tx.query<Ticket>(
      `UPDATE tickets SET status = 'called', called_at = $4
        WHERE id = ANY($1::uuid[]) AND unit_id = $2 AND fleet_id = $3 AND status = 'waiting' RETURNING ${COLUMNS}`,
      [ids, unitId, user.fleetId, this.clock.now().toISOString()],
    );
    // RETURNING does not promise an order. The caller is told who was called in the order the plan chose them.
    rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    for (const ticket of rows) {
      await publish(tx, {
        event: EVENTS.TICKET_CALLED,
        fleetId: user.fleetId,
        payload: {
          ticket_id: ticket.id,
          unit_id: unitId,
          person_ref: ticket.person_ref,
          service: ticket.service,
        },
      });
    }
    return rows;
  }

  private async announce(tx: Tx, user: AuthUser, unitId: string): Promise<void> {
    const counts = await tx.query<{ waiting: string; on_board: string }>(
      `SELECT count(*) FILTER (WHERE status = 'waiting') AS waiting,
              count(DISTINCT person_ref) FILTER (WHERE status IN ('called', 'serving')) AS on_board
         FROM tickets WHERE unit_id = $1`,
      [unitId],
    );
    await publish(tx, {
      event: EVENTS.QUEUE_UPDATED,
      fleetId: user.fleetId,
      payload: {
        unit_id: unitId,
        waiting: Number(counts.rows[0]?.waiting ?? 0),
        on_board: Number(counts.rows[0]?.on_board ?? 0),
      },
    });
  }
}

function toWaiting(t: Ticket, seq: number): WaitingTicket {
  return { id: t.id, personRef: t.person_ref, service: t.service, priority: t.priority, seq };
}

function load(tickets: readonly Ticket[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const t of tickets)
    if (t.status === 'called' || t.status === 'serving') result[t.service] = (result[t.service] ?? 0) + 1;
  return result;
}
