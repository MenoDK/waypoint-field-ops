/**
 * How fast is this vehicle really going, and when will it arrive?
 *
 * The estimate is built from what the vehicle did recently, not from a speed limit. And it says how it was made:
 * `basis` tells the reader whether the speed was measured or assumed, and `source` whether the distance came from a
 * road router or is a straight line. An ETA that hides its method looks more certain than it is.
 */

export interface SpeedSample {
  speedKmh: number | null;
  accuracyM: number | null;
}

export interface SpeedOptions {
  /** Below this a sample is "standing still" and says nothing about cruising speed. */
  movingKmh: number;
  /** Used when there is not enough evidence. */
  defaultKmh: number;
  /** A fix worse than this is ignored. */
  accuracyLimitM: number;
  /** Fewer usable samples than this and the default is used instead. */
  minSamples?: number;
}

export interface SpeedEstimate {
  kmh: number;
  basis: 'measured' | 'default';
  samples: number;
}

/**
 * Mean of the moving samples, with the extremes trimmed once there are enough of them (a single spike from a bad fix
 * must not move the ETA). Standing time is excluded: a driver who waited ten minutes at a light is not a slow driver.
 */
export function estimateSpeedKmh(samples: readonly SpeedSample[], options: SpeedOptions): SpeedEstimate {
  const minSamples = options.minSamples ?? 3;
  const usable = samples
    .filter(
      (s) =>
        s.speedKmh !== null &&
        Number.isFinite(s.speedKmh) &&
        s.speedKmh > options.movingKmh &&
        (s.accuracyM === null || s.accuracyM <= options.accuracyLimitM),
    )
    .map((s) => s.speedKmh as number)
    .sort((a, b) => a - b);

  if (usable.length < minSamples)
    return { kmh: options.defaultKmh, basis: 'default', samples: usable.length };

  const trim = usable.length >= 10 ? Math.floor(usable.length * 0.1) : 0;
  const kept = usable.slice(trim, usable.length - trim);
  const mean = kept.reduce((sum, v) => sum + v, 0) / kept.length;
  return { kmh: mean, basis: 'measured', samples: usable.length };
}

export interface Eta {
  distanceKm: number;
  minutes: number;
  source: 'road' | 'straight_line';
  speedBasis: 'measured' | 'default' | 'router';
}

/** Straight-line ETA: distance over the estimated speed. A lower bound -- roads are never shorter than the crow flies. */
export function straightLineEta(distanceKm: number, speed: SpeedEstimate): Eta {
  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    minutes: Math.max(0, Math.round((distanceKm / speed.kmh) * 60)),
    source: 'straight_line',
    speedBasis: speed.basis,
  };
}
