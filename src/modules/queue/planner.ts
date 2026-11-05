/**
 * Who is called next? A pure function of the queue, with no I/O (ADR 0005).
 *
 * Three rules decide it, and each one exists because the obvious version of it is wrong:
 *
 * 1. Capacity counts PEOPLE on board, not tickets. Someone with three services occupies one place until the last one is
 *    done, so counting tickets would fill a unit with the first customers' paperwork.
 * 2. Someone already on board does not need a place. Their next service can be called even when the unit is full; if it
 *    could not, they would sit on a place that only frees when they finish services nobody is allowed to start.
 * 3. There is ONE admission rule (`admission`), used by "call the next" and by "call this one". Two entry points with two
 *    copies of the rule is how a ceiling ends up enforced on one screen and ignored on the other.
 */

export interface WaitingTicket {
  id: string;
  personRef: string;
  service: string;
  priority: boolean;
  /** Arrival order; lower is earlier. */
  seq: number;
}

export interface QueueState {
  /** Places on board. `null` means no ceiling is configured -- reported, never silently treated as "fine". */
  capacity: number | null;
  /** Distinct people with a ticket called or being served. */
  onBoard: ReadonlySet<string>;
  waiting: readonly WaitingTicket[];
  /** Tickets called or being served, per service: the load each station is already carrying. */
  stationLoad: Readonly<Record<string, number>>;
}

export type Admission =
  | { allowed: true; consumesPlace: boolean; warning: 'no_capacity_configured' | null }
  | { allowed: false; reason: 'full'; onBoard: number; capacity: number };

/** May this person be called now? The single place the ceiling is enforced. */
export function admission(state: Pick<QueueState, 'capacity' | 'onBoard'>, personRef: string): Admission {
  if (state.onBoard.has(personRef)) return { allowed: true, consumesPlace: false, warning: null };
  if (state.capacity === null)
    return { allowed: true, consumesPlace: true, warning: 'no_capacity_configured' };
  if (state.onBoard.size >= state.capacity) {
    return { allowed: false, reason: 'full', onBoard: state.onBoard.size, capacity: state.capacity };
  }
  return { allowed: true, consumesPlace: true, warning: null };
}

export interface PlannedCall {
  ticketId: string;
  personRef: string;
  service: string;
}

export interface Plan {
  calls: PlannedCall[];
  onBoard: number;
  capacity: number | null;
  freeSlots: number | null;
  reason: 'ok' | 'queue_empty' | 'full';
  warning: 'no_capacity_configured' | null;
}

interface Person {
  ref: string;
  priority: boolean;
  firstSeq: number;
  tickets: WaitingTicket[];
}

const byUrgency = (a: Person, b: Person): number =>
  Number(b.priority) - Number(a.priority) || a.firstSeq - b.firstSeq;

/**
 * The calls to make right now: at most one ticket per person, people already on board first (they cost no place), then new
 * people by priority and arrival order until the places run out. Each person's ticket is the one for the least loaded
 * service, so a unit with two stations does not queue everyone for the same one.
 */
export function planCalls(state: QueueState): Plan {
  const warning = state.capacity === null ? 'no_capacity_configured' : null;
  const freeSlots = state.capacity === null ? null : Math.max(0, state.capacity - state.onBoard.size);
  const base = { onBoard: state.onBoard.size, capacity: state.capacity, freeSlots, warning } as const;

  if (state.waiting.length === 0) return { ...base, calls: [], reason: 'queue_empty' };

  const people = new Map<string, Person>();
  for (const ticket of state.waiting) {
    const person = people.get(ticket.personRef) ?? {
      ref: ticket.personRef,
      priority: false,
      firstSeq: Infinity,
      tickets: [],
    };
    person.tickets.push(ticket);
    person.priority ||= ticket.priority;
    person.firstSeq = Math.min(person.firstSeq, ticket.seq);
    people.set(ticket.personRef, person);
  }

  const inside = [...people.values()].filter((p) => state.onBoard.has(p.ref)).sort(byUrgency);
  const outside = [...people.values()].filter((p) => !state.onBoard.has(p.ref)).sort(byUrgency);
  const newcomers = freeSlots === null ? outside : outside.slice(0, freeSlots);

  const load: Record<string, number> = { ...state.stationLoad };
  const calls: PlannedCall[] = [];
  for (const person of [...inside, ...newcomers]) {
    const chosen = [...person.tickets].sort(
      (a, b) => (load[a.service] ?? 0) - (load[b.service] ?? 0) || a.seq - b.seq,
    )[0]!;
    load[chosen.service] = (load[chosen.service] ?? 0) + 1;
    calls.push({ ticketId: chosen.id, personRef: chosen.personRef, service: chosen.service });
  }

  if (calls.length === 0) return { ...base, calls, reason: 'full' };
  return { ...base, calls, reason: 'ok' };
}
