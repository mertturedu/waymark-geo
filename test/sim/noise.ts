import type { LngLat } from '../../src/core/geo/cells';
import { normal, type Rand } from './random';

export const DELIVERY_SD_M = 10;
export const PIN_SD_M = 4;
export const OUTLIER_RATE = 0.05;
export const OUTLIER_MIN_M = 80;
export const OUTLIER_MAX_M = 300;

const M_PER_DEGREE = 111_195;
const RAD = Math.PI / 180;
const ACCURACY_LOW = 0.5;
const ACCURACY_SPAN = 1.5;

export type Noisy = { point: LngLat; accuracyM: number; deviationM: number; outlier: boolean };

export function moveBy(p: LngLat, eastM: number, northM: number): LngLat {
  return [p[0] + eastM / (M_PER_DEGREE * Math.cos(p[1] * RAD)), p[1] + northM / M_PER_DEGREE];
}

function report(rand: Rand, truth: LngLat, east: number, north: number, outlier: boolean): Noisy {
  const deviationM = Math.hypot(east, north);
  return { point: moveBy(truth, east, north), accuracyM: deviationM * (ACCURACY_LOW + ACCURACY_SPAN * rand()), deviationM, outlier };
}

export function forcedOutlier(rand: Rand, truth: LngLat, distanceM: number): Noisy {
  const angle = 2 * Math.PI * rand();
  return report(rand, truth, distanceM * Math.cos(angle), distanceM * Math.sin(angle), true);
}

export function deliveryNoise(rand: Rand, truth: LngLat, options: { outliers?: boolean } = {}): Noisy {
  const far = rand() < OUTLIER_RATE;
  const distance = OUTLIER_MIN_M + (OUTLIER_MAX_M - OUTLIER_MIN_M) * rand();
  if (far && options.outliers !== false) return forcedOutlier(rand, truth, distance);
  return report(rand, truth, normal(rand, DELIVERY_SD_M), normal(rand, DELIVERY_SD_M), false);
}

export function pinNoise(rand: Rand, truth: LngLat): Noisy {
  return report(rand, truth, normal(rand, PIN_SD_M), normal(rand, PIN_SD_M), false);
}
