import { Inject, Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { AuthUser } from '../../common/auth';
import { Clock } from '../../common/clock';
import { AppException, notFound } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { type LatLng, pathLengthKm } from '../../geo/geo';
import { signSheetLink, verifySheetLink } from './signed-url';

interface SheetRow {
  id: string;
  fleet_name: string;
  status: string;
  vehicle: string;
  driver: string;
  origin: string;
  destination: string;
  planned_departure: Date;
  started_at: Date | null;
  arrived_at: Date | null;
  completed_at: Date | null;
  km_start: number | null;
  km_end: number | null;
}

/** The standard PDF fonts speak WinAnsi only: anything else is replaced, not crashed on. */
const printable = (text: string): string => text.replace(/[^\x20-\x7E]/g, '?');
const when = (d: Date | null): string => (d ? d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '-');

@Injectable()
export class SheetService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** A short-lived link to the trip sheet. Asking for one is authorised (the trip must be in the caller's fleet). */
  async link(user: AuthUser, tripId: string): Promise<{ url: string; expires_at: string }> {
    const { rows } = await this.db.query('SELECT 1 FROM trips WHERE id = $1 AND fleet_id = $2', [
      tripId,
      user.fleetId,
    ]);
    if (rows.length === 0) throw notFound('Trip');
    const exp = Math.floor(this.clock.now().getTime() / 1000) + this.env.SIGNED_URL_TTL_SECONDS;
    const sig = signSheetLink(this.env.SIGNED_URL_SECRET, tripId, user.fleetId, exp);
    return {
      url: `/v1/trips/${tripId}/sheet.pdf?exp=${exp}&sig=${sig}`,
      expires_at: new Date(exp * 1000).toISOString(),
    };
  }

  /**
   * Renders the sheet for a link. No bearer token: the link IS the permission, and it is checked against the fleet that
   * actually owns the trip, so a link for one fleet's trip cannot be bent into another's.
   */
  async render(tripId: string, exp: unknown, sig: unknown): Promise<Buffer> {
    const { rows } = await this.db.query<SheetRow & { fleet_id: string }>(
      `SELECT tr.id, tr.fleet_id, f.name AS fleet_name, tr.status, v.label AS vehicle, u.name AS driver,
              o.name AS origin, d.name AS destination, tr.planned_departure, tr.started_at, tr.arrived_at,
              tr.completed_at, tr.km_start, tr.km_end
         FROM trips tr
         JOIN fleets f ON f.id = tr.fleet_id
         JOIN vehicles v ON v.id = tr.vehicle_id
         JOIN users u ON u.id = tr.driver_id
         JOIN places o ON o.id = tr.origin_id
         JOIN places d ON d.id = tr.destination_id
        WHERE tr.id = $1`,
      [tripId],
    );
    const trip = rows[0];
    // An unknown trip and a bad signature look the same from outside: the link reveals nothing about what exists.
    const verdict = trip
      ? verifySheetLink(
          this.env.SIGNED_URL_SECRET,
          { tripId, fleetId: trip.fleet_id, exp, sig },
          Math.floor(this.clock.now().getTime() / 1000),
        )
      : 'invalid';
    if (verdict === 'expired')
      throw new AppException(410, 'LINK_EXPIRED', 'This link has expired; ask for a new one');
    if (verdict !== 'ok' || !trip) throw new AppException(403, 'INVALID_LINK', 'This link is not valid');

    const trail = await this.db.query<{ lat: number; lng: number }>(
      `SELECT ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng FROM pings
        WHERE trip_id = $1 AND (accuracy_m IS NULL OR accuracy_m <= $2) ORDER BY captured_at LIMIT 20000`,
      [tripId, this.env.ACCURACY_LIMIT_M],
    );
    const points: LatLng[] = trail.rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lng) }));
    return this.draw(trip, points);
  }

  private async draw(trip: SheetRow, points: LatLng[]): Promise<Buffer> {
    const pdf = await PDFDocument.create();
    pdf.setTitle(`Trip sheet ${trip.id}`);
    pdf.setCreator('waypoint-field-ops');
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let y = 790;
    const line = (label: string, value: string): void => {
      page.drawText(label, { x: 50, y, size: 10, font: bold, color: rgb(0.25, 0.25, 0.3) });
      page.drawText(printable(value), { x: 190, y, size: 11, font });
      y -= 22;
    };
    page.drawText('Trip sheet', { x: 50, y, size: 22, font: bold });
    y -= 36;
    line('Trip', trip.id);
    line('Fleet', trip.fleet_name);
    line('Status', trip.status);
    line('Vehicle', trip.vehicle);
    line('Driver', trip.driver);
    line('From', trip.origin);
    line('To', trip.destination);
    line('Planned departure', when(trip.planned_departure));
    line('Started', when(trip.started_at));
    line('Arrived (geofence)', when(trip.arrived_at));
    line('Completed', when(trip.completed_at));
    line('Odometer start', trip.km_start === null ? '-' : `${trip.km_start} km`);
    line('Odometer end', trip.km_end === null ? '-' : `${trip.km_end} km`);
    line(
      'Distance by odometer',
      trip.km_start !== null && trip.km_end !== null ? `${trip.km_end - trip.km_start} km` : '-',
    );
    line(
      'Distance by GPS',
      points.length >= 2 ? `${pathLengthKm(points).toFixed(1)} km (${points.length} fixes)` : '-',
    );
    y -= 12;
    page.drawText(
      'The GPS figure is a cross-check, not the record: it covers only the positions still within the retention window.',
      { x: 50, y, size: 8.5, font, color: rgb(0.4, 0.4, 0.45), maxWidth: 495 },
    );
    return Buffer.from(await pdf.save());
  }
}
