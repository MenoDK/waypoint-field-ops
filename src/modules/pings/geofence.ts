/**
 * Has the vehicle arrived? Not "was one reading inside the circle": a single fix near the boundary is as likely to be GPS
 * jitter as a vehicle, so an arrival needs the last N GOOD fixes (accurate ones) to all be inside the radius.
 *
 * `fixes` are newest first, each with its distance to the destination in metres. The caller has already dropped fixes whose
 * accuracy is too poor to mean anything.
 */
export interface Fix {
  distanceM: number;
}

export function hasArrived(fixes: readonly Fix[], radiusM: number, confirmations: number): boolean {
  if (fixes.length < confirmations) return false;
  return fixes.slice(0, confirmations).every((fix) => fix.distanceM <= radiusM);
}
