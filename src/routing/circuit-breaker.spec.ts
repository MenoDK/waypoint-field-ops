import { CircuitBreaker } from './circuit-breaker';

function make(failuresToOpen = 3, openForMs = 1000) {
  let t = 0;
  const breaker = new CircuitBreaker({ failuresToOpen, openForMs, now: () => t });
  return { breaker, advance: (ms: number) => (t += ms) };
}

describe('CircuitBreaker', () => {
  it('starts closed and lets calls through', () => {
    const { breaker } = make();
    expect(breaker.state()).toBe('closed');
    expect(breaker.tryAcquire()).toBe(true);
  });

  it('opens after the configured number of consecutive failures, and not before', () => {
    const { breaker } = make(3);
    breaker.failure();
    breaker.failure();
    expect(breaker.state()).toBe('closed');
    breaker.failure();
    expect(breaker.state()).toBe('open');
    expect(breaker.tryAcquire()).toBe(false);
  });

  it('a success in between resets the count: failures must be consecutive', () => {
    const { breaker } = make(3);
    breaker.failure();
    breaker.failure();
    breaker.success();
    breaker.failure();
    breaker.failure();
    expect(breaker.state()).toBe('closed');
  });

  it('stays open for the whole pause', () => {
    const { breaker, advance } = make(1, 1000);
    breaker.failure();
    advance(999);
    expect(breaker.state()).toBe('open');
    expect(breaker.tryAcquire()).toBe(false);
  });

  it('after the pause lets exactly ONE probe through', () => {
    const { breaker, advance } = make(1, 1000);
    breaker.failure();
    advance(1000);
    expect(breaker.state()).toBe('half_open');
    expect(breaker.tryAcquire()).toBe(true);
    expect(breaker.tryAcquire()).toBe(false);
    expect(breaker.tryAcquire()).toBe(false);
  });

  it('closes when the probe succeeds', () => {
    const { breaker, advance } = make(1, 1000);
    breaker.failure();
    advance(1000);
    breaker.tryAcquire();
    breaker.success();
    expect(breaker.state()).toBe('closed');
    expect(breaker.tryAcquire()).toBe(true);
    expect(breaker.tryAcquire()).toBe(true);
  });

  it('re-opens for a FULL new pause when the probe fails', () => {
    const { breaker, advance } = make(1, 1000);
    breaker.failure();
    advance(1000);
    breaker.tryAcquire();
    breaker.failure();
    expect(breaker.state()).toBe('open');
    advance(999);
    expect(breaker.tryAcquire()).toBe(false);
    advance(1);
    expect(breaker.tryAcquire()).toBe(true);
  });

  it('reports how long until it reopens', () => {
    const { breaker, advance } = make(1, 1000);
    breaker.failure();
    advance(400);
    expect(breaker.snapshot()).toEqual({ state: 'open', consecutiveFailures: 1, reopensInMs: 600 });
  });
});
