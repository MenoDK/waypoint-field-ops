/**
 * The demonstration's cast, in one place: the seed creates exactly these, and the field simulator signs in as exactly these.
 * Every address ends in `.example.test`, a name that can never belong to a real mailbox.
 */
export interface DemoFleet {
  name: string;
  slug: string;
  drivers: string[];
  vehiclePrefix: string;
  unit: { name: string; capacity: number };
}

export const DEMO_FLEETS: readonly DemoFleet[] = [
  {
    name: 'Prairie Freight',
    slug: 'prairie',
    drivers: ['Avery Cole', 'Blake Ortiz', 'Casey Lin', 'Devon Park'],
    vehiclePrefix: 'TRK',
    unit: { name: 'Mobile Unit 1', capacity: 3 },
  },
  {
    name: 'Harbor Couriers',
    slug: 'harbor',
    drivers: ['Eli Novak', 'Finn Hart'],
    vehiclePrefix: 'VAN',
    unit: { name: 'Mobile Unit B1', capacity: 2 },
  },
];

export const driverEmail = (slug: string, index: number): string => `driver${index + 1}@${slug}.example.test`;
export const dispatcherEmail = (slug: string): string => `dispatcher@${slug}.example.test`;

/** Every simulated phone's account. */
export const DEMO_DRIVER_EMAILS: readonly string[] = DEMO_FLEETS.flatMap((fleet) =>
  fleet.drivers.map((_, index) => driverEmail(fleet.slug, index)),
);
