import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { type Eta, estimateSpeedKmh, type SpeedSample, straightLineEta } from '../../geo/eta';
import { haversineKm, type LatLng } from '../../geo/geo';
import { RoutingService } from '../../routing/routing.service';

/**
 * ETA with its method attached (ADR 0006).
 *
 *  - If a road router is configured, healthy and believable, the distance is the road distance. The speed is the driver's own
 *    measured speed when there is enough history, otherwise the router's idea of the trip time.
 *  - If not -- no router, breaker open, an answer that failed the sanity checks -- the distance is the straight line and the
 *    result says `straight_line`. A lower bound, labelled as one, is better than a precise-looking number that is made up.
 */
@Injectable()
export class EtaService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(RoutingService) private readonly routing: RoutingService,
  ) {}

  /** Whether road routing is in use, for the snapshot and the health check. */
  status(): ReturnType<RoutingService['status']> {
    return this.routing.status();
  }

  async estimate(
    position: LatLng,
    destination: LatLng,
    samples: readonly SpeedSample[],
    options: { useRouter: boolean },
  ): Promise<Eta> {
    const speed = estimateSpeedKmh(samples, {
      movingKmh: this.env.MOVING_KMH,
      defaultKmh: this.env.DEFAULT_SPEED_KMH,
      accuracyLimitM: this.env.ACCURACY_LIMIT_M,
    });
    const road = options.useRouter ? await this.routing.route(position, destination) : null;
    if (!road) return straightLineEta(haversineKm(position, destination), speed);

    const measured = speed.basis === 'measured';
    return {
      distanceKm: Math.round(road.distanceKm * 10) / 10,
      minutes: Math.max(0, Math.round(measured ? (road.distanceKm / speed.kmh) * 60 : road.durationMinutes)),
      source: 'road',
      speedBasis: measured ? 'measured' : 'router',
    };
  }
}
