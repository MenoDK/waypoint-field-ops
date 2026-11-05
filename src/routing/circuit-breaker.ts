/**
 * Stops asking a service that keeps failing, and lets exactly one request through to find out whether it came back.
 *
 *   closed    -> calls pass; `failuresToOpen` failures in a row open it
 *   open      -> calls are refused instantly until `openForMs` has passed
 *   half_open -> ONE probe is allowed; its success closes the breaker, its failure re-opens it for another full period
 *
 * The single probe matters: if every waiting request were let through the moment the pause ended, the first thing a
 * recovering service would see is the whole backlog. State is per instance (no module-level singleton), time comes from an
 * injected clock, so each behaviour is a plain test.
 */
export type BreakerState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private probing = false;

  constructor(private readonly options: { failuresToOpen: number; openForMs: number; now?: () => number }) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  state(): BreakerState {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.options.openForMs ? 'half_open' : 'open';
  }

  /** May a call go out? In `half_open` this hands out the single probe: the caller MUST then report success() or failure(). */
  tryAcquire(): boolean {
    const state = this.state();
    if (state === 'closed') return true;
    if (state === 'open') return false;
    if (this.probing) return false;
    this.probing = true;
    return true;
  }

  success(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probing = false;
  }

  failure(): void {
    this.probing = false;
    this.failures += 1;
    if (this.openedAt !== null || this.failures >= this.options.failuresToOpen) this.openedAt = this.now();
  }

  /** For diagnostics and the lab. */
  snapshot(): { state: BreakerState; consecutiveFailures: number; reopensInMs: number } {
    const reopens =
      this.openedAt === null ? 0 : Math.max(0, this.options.openForMs - (this.now() - this.openedAt));
    return { state: this.state(), consecutiveFailures: this.failures, reopensInMs: reopens };
  }
}
