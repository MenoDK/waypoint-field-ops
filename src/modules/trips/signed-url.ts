import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A link that carries its own permission: `/v1/trips/<id>/sheet.pdf?exp=<unix seconds>&sig=<mac>`.
 *
 * The MAC covers the trip, the fleet that owns it and the expiry, under a key only the server holds. So the link cannot be
 * pointed at another trip, cannot have its expiry extended, and is worthless once it expires. It is NOT single-use: anyone
 * who holds the link can use it until `exp`, which is why the lifetime is short and the document is one a driver may show.
 */
export type LinkCheck = 'ok' | 'expired' | 'invalid';

function mac(secret: string, tripId: string, fleetId: string, exp: number): Buffer {
  return createHmac('sha256', secret).update(`sheet.v1\n${tripId}\n${fleetId}\n${exp}`).digest();
}

export function signSheetLink(secret: string, tripId: string, fleetId: string, exp: number): string {
  return mac(secret, tripId, fleetId, exp).toString('base64url');
}

export function verifySheetLink(
  secret: string,
  input: { tripId: string; fleetId: string; exp: unknown; sig: unknown },
  nowSeconds: number,
): LinkCheck {
  const { exp, sig } = input;
  if (
    typeof exp !== 'string' ||
    !/^\d{1,12}$/.test(exp) ||
    typeof sig !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(sig)
  ) {
    return 'invalid';
  }
  const expected = mac(secret, input.tripId, input.fleetId, Number(exp));
  const given = Buffer.from(sig, 'base64url');
  // 32 bytes leave two spare bits in the last base64url character. A decoder ignores them, so without this line several
  // different strings would decode to the same MAC and one link would have four spellings. Only the canonical one is a link.
  if (given.toString('base64url') !== sig) return 'invalid';
  // Verify the MAC before looking at the clock: an expired-but-forged link must read as forged, not as "just expired".
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'invalid';
  return Number(exp) < nowSeconds ? 'expired' : 'ok';
}
