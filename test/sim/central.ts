import type { DeliveryRecord } from '../../pipeline/real/records';
import { usable } from '../../pipeline/real/records';
import type { LngLat } from '../../src/core/geo/cells';
import { deliveryNoise, forcedOutlier, pinNoise } from './noise';
import type { Rand } from './random';

export const COURIERS = 60;
export const PIN_SHARE = 0.3;
export const WRONG_PIN_SHARE = 0.08;
export const WRONG_PIN_MIN_M = 40;
export const WRONG_PIN_SPAN_M = 110;
export const COUNTS = [1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 8];
export const SIM_WEEK = 2800;

export type Spot = { plate: string; district: string; neighbourhood: string | null; street: string; houseNumber: string; truth: LngLat };

export const courier = (rand: Rand, prefix: string): string => `${prefix}${Math.floor(rand() ** 2 * COURIERS)}`;

export function deliveriesFor(spot: Spot, rand: Rand, count: number, prefix = 'c', week = SIM_WEEK): DeliveryRecord[] {
  const out: DeliveryRecord[] = [];
  for (let i = 0; i < count; i++) {
    const gps = deliveryNoise(rand, spot.truth);
    const withPin = rand() < PIN_SHARE;
    const pin = withPin ? (rand() < WRONG_PIN_SHARE ? forcedOutlier(rand, spot.truth, WRONG_PIN_MIN_M + WRONG_PIN_SPAN_M * rand()) : pinNoise(rand, spot.truth)) : null;
    const record: DeliveryRecord = {
      v: 1,
      src: courier(rand, prefix),
      week,
      region: spot.plate,
      district: spot.district,
      ...(spot.neighbourhood ? { neighbourhood: spot.neighbourhood } : {}),
      street: spot.street,
      houseNumber: spot.houseNumber,
      coordSource: pin ? 'pin' : 'gps',
      gps: { lng: gps.point[0], lat: gps.point[1], accuracyM: Math.max(1, gps.accuracyM) },
      ...(pin ? { pin: { lng: pin.point[0], lat: pin.point[1] } } : {}),
    };
    if (usable(record)) out.push(record);
  }
  return out;
}

export const pickCount = (rand: Rand): number => COUNTS[Math.floor(rand() * COUNTS.length)] as number;
