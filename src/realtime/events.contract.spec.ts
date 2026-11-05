import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_EVENTS, EVENTS } from './events';

/**
 * An event name is a string on both sides of a socket, and a string does not break when one side is renamed: the screen
 * just stops hearing it and looks fine because something else happens to refresh. So the contract is checked from both ends
 * (ADR 0007): the browser code may only use names the server has, and the server must really emit every name it declares.
 */
const SRC = join(__dirname, '..');
const SITE = join(__dirname, '..', '..', 'site');

function* files(dir: string, suffix: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path, suffix);
    else if (name.endsWith(suffix)) yield path;
  }
}

describe('the real-time event contract', () => {
  it('the lab listens to exactly the events the server declares', () => {
    const lab = readFileSync(join(SITE, 'lab.js'), 'utf8');
    const declared = /const EVENT_NAMES = \[([^\]]*)\]/.exec(lab);
    expect(declared).not.toBeNull();
    const listed = [...(declared as RegExpExecArray)[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...listed].sort()).toEqual([...ALL_EVENTS].sort());
  });

  it('the lab never spells an event name anywhere else without it being a real one', () => {
    const lab = readFileSync(join(SITE, 'lab.js'), 'utf8');
    const known = new Set<string>(ALL_EVENTS);
    // Anything that looks like one of our event names: "position", or "<area>.<what>" for the areas we emit from.
    const looksLikeAnEvent = [...lab.matchAll(/'(position|(?:alert|trip|queue|ticket)\.[a-z_]+)'/g)].map(
      (m) => m[1]!,
    );
    expect(looksLikeAnEvent.length).toBeGreaterThan(ALL_EVENTS.length); // the list itself plus the places that use the names
    for (const name of looksLikeAnEvent) expect(known.has(name)).toBe(true);
  });

  it('every declared event is emitted by some code that is not the declaration or the gateway', () => {
    const sources = [...files(SRC, '.ts')]
      .filter(
        (f) =>
          !f.endsWith('.spec.ts') && !f.endsWith('realtime/events.ts') && !f.endsWith('realtime.gateway.ts'),
      )
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    for (const key of Object.keys(EVENTS)) {
      expect(sources).toContain(`EVENTS.${key}`);
    }
  });
});
