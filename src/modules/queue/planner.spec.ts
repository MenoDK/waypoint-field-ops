import { admission, planCalls, type QueueState, type WaitingTicket } from './planner';

let counter = 0;
const ticket = (personRef: string, service: string, over: Partial<WaitingTicket> = {}): WaitingTicket => {
  counter += 1;
  return { id: `t${counter}`, personRef, service, priority: false, seq: counter, ...over };
};
const state = (over: Partial<QueueState> = {}): QueueState => ({
  capacity: 3,
  onBoard: new Set(),
  waiting: [],
  stationLoad: {},
  ...over,
});

beforeEach(() => {
  counter = 0;
});

describe('admission: the one place the ceiling is enforced', () => {
  it('lets a new person in while there is a free place', () => {
    expect(admission({ capacity: 2, onBoard: new Set(['a']) }, 'b')).toEqual({
      allowed: true,
      consumesPlace: true,
      warning: null,
    });
  });

  it('refuses a new person when the unit is full, and says by how much', () => {
    expect(admission({ capacity: 2, onBoard: new Set(['a', 'b']) }, 'c')).toEqual({
      allowed: false,
      reason: 'full',
      onBoard: 2,
      capacity: 2,
    });
  });

  it('lets someone who is already on board continue, even when the unit is full (they take no new place)', () => {
    expect(admission({ capacity: 2, onBoard: new Set(['a', 'b']) }, 'a')).toEqual({
      allowed: true,
      consumesPlace: false,
      warning: null,
    });
  });

  it('with no ceiling configured, allows but warns, instead of pretending nothing is wrong', () => {
    expect(admission({ capacity: null, onBoard: new Set() }, 'a')).toEqual({
      allowed: true,
      consumesPlace: true,
      warning: 'no_capacity_configured',
    });
  });
});

describe('planCalls', () => {
  it('reports an empty queue', () => {
    expect(planCalls(state())).toMatchObject({ calls: [], reason: 'queue_empty', freeSlots: 3 });
  });

  it('calls people in arrival order up to the free places', () => {
    const waiting = [ticket('a', 'x'), ticket('b', 'x'), ticket('c', 'x'), ticket('d', 'x')];
    const plan = planCalls(state({ waiting }));
    expect(plan.calls.map((c) => c.personRef)).toEqual(['a', 'b', 'c']);
    expect(plan.reason).toBe('ok');
  });

  it('puts priority first, then arrival order', () => {
    const waiting = [ticket('a', 'x'), ticket('b', 'x'), ticket('c', 'x', { priority: true })];
    const plan = planCalls(state({ capacity: 2, waiting }));
    expect(plan.calls.map((c) => c.personRef)).toEqual(['c', 'a']);
  });

  it('counts people, not tickets: one person with three services takes one place', () => {
    const waiting = [
      ticket('a', 'x'),
      ticket('a', 'y'),
      ticket('a', 'z'),
      ticket('b', 'x'),
      ticket('c', 'x'),
    ];
    const plan = planCalls(state({ capacity: 2, waiting }));
    expect(plan.calls.map((c) => c.personRef)).toEqual(['a', 'b']);
    expect(plan.calls).toHaveLength(2); // and only one ticket of a's is called now
  });

  it('subtracts the people already on board from the free places', () => {
    const waiting = [ticket('c', 'x'), ticket('d', 'x')];
    const plan = planCalls(state({ capacity: 3, onBoard: new Set(['a', 'b']), waiting }));
    expect(plan.freeSlots).toBe(1);
    expect(plan.calls.map((c) => c.personRef)).toEqual(['c']);
  });

  it('says "full" when nobody can be called', () => {
    const waiting = [ticket('c', 'x')];
    const plan = planCalls(state({ capacity: 2, onBoard: new Set(['a', 'b']), waiting }));
    expect(plan).toMatchObject({ calls: [], reason: 'full', freeSlots: 0 });
  });

  it('still calls the next service of someone already on board when the unit is full', () => {
    const waiting = [ticket('a', 'y'), ticket('c', 'x')];
    const plan = planCalls(state({ capacity: 2, onBoard: new Set(['a', 'b']), waiting }));
    expect(plan.calls.map((c) => c.personRef)).toEqual(['a']);
    expect(plan.reason).toBe('ok');
  });

  it('calls people already on board before new ones', () => {
    const waiting = [ticket('c', 'x'), ticket('a', 'y')];
    const plan = planCalls(state({ capacity: 3, onBoard: new Set(['a']), waiting }));
    expect(plan.calls.map((c) => c.personRef)).toEqual(['a', 'c']);
  });

  it("chooses each person's ticket by the least loaded service, then by arrival", () => {
    const waiting = [ticket('a', 'x'), ticket('a', 'y')];
    expect(planCalls(state({ waiting, stationLoad: { x: 2, y: 0 } })).calls[0]?.service).toBe('y');
    expect(planCalls(state({ waiting, stationLoad: { x: 0, y: 0 } })).calls[0]?.service).toBe('x');
  });

  it('spreads people over the services as it plans, not onto the same one', () => {
    const waiting = [ticket('a', 'x'), ticket('a', 'y'), ticket('b', 'x'), ticket('b', 'y')];
    const plan = planCalls(state({ waiting }));
    expect(plan.calls.map((c) => c.service).sort()).toEqual(['x', 'y']);
  });

  it('with no ceiling configured it calls everyone and warns', () => {
    const waiting = [ticket('a', 'x'), ticket('b', 'x'), ticket('c', 'x'), ticket('d', 'x')];
    const plan = planCalls(state({ capacity: null, waiting }));
    expect(plan.calls).toHaveLength(4);
    expect(plan.warning).toBe('no_capacity_configured');
    expect(plan.freeSlots).toBeNull();
  });

  it('is deterministic: the same queue gives the same plan', () => {
    const waiting = [ticket('a', 'x'), ticket('b', 'y'), ticket('c', 'x', { priority: true })];
    expect(planCalls(state({ waiting }))).toEqual(planCalls(state({ waiting })));
  });
});
