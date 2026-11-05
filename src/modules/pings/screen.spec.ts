import { batchSchema, pingSchema, screenPing, type PingInput, type ScreenOptions } from './screen';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const options: ScreenOptions = { now: NOW, retentionDays: 7, maxFutureSkewSeconds: 300 };
const ping = (over: Partial<PingInput> = {}): PingInput => ({
  lat: 38.5,
  lng: -98,
  captured_at: '2026-03-01T11:59:00.000Z',
  source: 'polling',
  ...over,
});

describe('screenPing', () => {
  it('accepts a normal reading and returns its capture time', () => {
    expect(screenPing(ping(), options)).toEqual({
      ok: true,
      capturedAt: new Date('2026-03-01T11:59:00.000Z'),
    });
  });

  it.each([
    ['no fix at all (0, 0)', { lat: 0, lng: 0 }],
    ['latitude out of range', { lat: 91 }],
    ['longitude out of range', { lng: -181 }],
    ['not a number', { lat: Number.NaN }],
  ])('rejects %s as a bad coordinate', (_name, over) => {
    expect(screenPing(ping(over), options)).toEqual({ ok: false, reason: 'bad_coordinate' });
  });

  it('allows a little clock skew but rejects a capture from the future', () => {
    expect(screenPing(ping({ captured_at: '2026-03-01T12:04:59.000Z' }), options).ok).toBe(true);
    expect(screenPing(ping({ captured_at: '2026-03-01T12:05:01.000Z' }), options)).toEqual({
      ok: false,
      reason: 'future',
    });
  });

  it('rejects a capture older than the retention window, and accepts one just inside it', () => {
    expect(screenPing(ping({ captured_at: '2026-02-22T12:00:01.000Z' }), options).ok).toBe(true);
    expect(screenPing(ping({ captured_at: '2026-02-22T11:59:59.000Z' }), options)).toEqual({
      ok: false,
      reason: 'too_old',
    });
  });

  it('honours a different retention', () => {
    const short = { ...options, retentionDays: 1 };
    expect(screenPing(ping({ captured_at: '2026-02-28T11:00:00.000Z' }), short)).toEqual({
      ok: false,
      reason: 'too_old',
    });
  });
});

describe('pingSchema', () => {
  const valid = { lat: 38.5, lng: -98, captured_at: '2026-03-01T11:59:00Z' };

  it('accepts a minimal ping and defaults the source', () => {
    expect(pingSchema.parse(valid).source).toBe('polling');
  });

  it('accepts offsets on timestamps', () => {
    expect(pingSchema.safeParse({ ...valid, captured_at: '2026-03-01T08:59:00-03:00' }).success).toBe(true);
  });

  it.each([
    ['a timestamp without a zone', { captured_at: '2026-03-01T11:59:00' }],
    ['a date only', { captured_at: '2026-03-01' }],
    ['coordinates as strings', { lat: '38.5' }],
    ['a negative speed', { speed_kmh: -1 }],
    ['an impossible speed', { speed_kmh: 900 }],
    ['a heading of 360', { heading_deg: 360 }],
    ['an unknown source', { source: 'magic' }],
    ['a field it does not know (strict)', { vehicle_id: 'someone-else' }],
  ])('rejects %s', (_name, over) => {
    expect(pingSchema.safeParse({ ...valid, ...over }).success).toBe(false);
  });
});

describe('batchSchema', () => {
  const one = { lat: 38.5, lng: -98, captured_at: '2026-03-01T11:59:00Z' };

  it('bounds the batch, so one request cannot make the server do unbounded work', () => {
    const schema = batchSchema(3);
    expect(schema.safeParse({ pings: [one, one, one] }).success).toBe(true);
    expect(schema.safeParse({ pings: [one, one, one, one] }).success).toBe(false);
    expect(schema.safeParse({ pings: [] }).success).toBe(false);
  });
});
