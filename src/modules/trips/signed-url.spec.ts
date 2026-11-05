import { signSheetLink, verifySheetLink } from './signed-url';

const SECRET = 'a-secret-that-is-long-enough-for-the-tests';
const TRIP = '11111111-1111-4111-8111-111111111111';
const OTHER_TRIP = '22222222-2222-4222-8222-222222222222';
const FLEET = '33333333-3333-4333-8333-333333333333';
const OTHER_FLEET = '44444444-4444-4444-8444-444444444444';
const NOW = 1_800_000_000;

const link = (over: Partial<Parameters<typeof verifySheetLink>[1]> = {}) => {
  const exp = NOW + 300;
  return {
    tripId: TRIP,
    fleetId: FLEET,
    exp: String(exp),
    sig: signSheetLink(SECRET, TRIP, FLEET, exp),
    ...over,
  };
};

describe('signed trip-sheet links', () => {
  it('accepts a link it signed, before it expires', () => {
    expect(verifySheetLink(SECRET, link(), NOW)).toBe('ok');
  });

  it('refuses a link after it expires, and accepts it up to the last second', () => {
    expect(verifySheetLink(SECRET, link(), NOW + 300)).toBe('ok');
    expect(verifySheetLink(SECRET, link(), NOW + 301)).toBe('expired');
  });

  it('refuses a link pointed at another trip', () => {
    expect(verifySheetLink(SECRET, link({ tripId: OTHER_TRIP }), NOW)).toBe('invalid');
  });

  it('refuses a link whose trip belongs to another fleet', () => {
    expect(verifySheetLink(SECRET, link({ fleetId: OTHER_FLEET }), NOW)).toBe('invalid');
  });

  it('refuses a link with its expiry extended', () => {
    expect(verifySheetLink(SECRET, link({ exp: String(NOW + 86_400) }), NOW)).toBe('invalid');
  });

  it('refuses a signature made with another key', () => {
    const forged = signSheetLink('another-secret-another-secret-another!', TRIP, FLEET, NOW + 300);
    expect(verifySheetLink(SECRET, link({ sig: forged }), NOW)).toBe('invalid');
  });

  it('has exactly one spelling: the spare bits of the last character cannot be used to make an alias', () => {
    const sig = signSheetLink(SECRET, TRIP, FLEET, NOW + 300);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const aliases = [...alphabet]
      .map((c) => `${sig.slice(0, -1)}${c}`)
      .filter(
        (candidate) =>
          candidate !== sig && Buffer.from(candidate, 'base64url').equals(Buffer.from(sig, 'base64url')),
      );
    expect(aliases.length).toBeGreaterThan(0); // the premise: such aliases DO decode to the same bytes
    for (const alias of aliases) expect(verifySheetLink(SECRET, link({ sig: alias }), NOW)).toBe('invalid');
    expect(verifySheetLink(SECRET, link({ sig }), NOW)).toBe('ok');
  });

  it('reads a forged link that is also expired as forged, not as merely expired', () => {
    const forged = signSheetLink('another-secret-another-secret-another!', TRIP, FLEET, NOW - 10);
    expect(
      verifySheetLink(SECRET, { tripId: TRIP, fleetId: FLEET, exp: String(NOW - 10), sig: forged }, NOW),
    ).toBe('invalid');
  });

  it.each([
    ['missing exp', { exp: undefined }],
    ['non-numeric exp', { exp: 'tomorrow' }],
    ['negative exp', { exp: '-5' }],
    ['array exp', { exp: ['1', '2'] }],
    ['missing sig', { sig: undefined }],
    ['short sig', { sig: 'abc' }],
    ['array sig', { sig: ['a', 'b'] }],
  ])('refuses malformed input: %s', (_name, over) => {
    expect(verifySheetLink(SECRET, link(over as never), NOW)).toBe('invalid');
  });
});
