import { distanceM } from '../../src/core/geo/distance';
import type { LngLat } from '../../src/core/geo/cells';
import { DELIVERY_SD_M, deliveryNoise, forcedOutlier, moveBy, OUTLIER_MAX_M, OUTLIER_MIN_M, OUTLIER_RATE, PIN_SD_M, pinNoise } from './noise';
import { rng } from './random';

const TRUTH: LngLat = [32.85, 39.93];

describe('moveBy', () => {
  it('moves a point by the asked metres', () => {
    for (const [east, north] of [[100, 0], [0, 100], [-60, 80], [0, 0]] as [number, number][]) {
      expect(Math.abs(distanceM(TRUTH, moveBy(TRUTH, east, north)) - Math.hypot(east, north))).toBeLessThan(0.15);
    }
    const e = moveBy(TRUTH, 50, 0);
    expect(e[0]).toBeGreaterThan(TRUTH[0]);
    expect(e[1]).toBe(TRUTH[1]);
    const n = moveBy(TRUTH, 0, -50);
    expect(n[1]).toBeLessThan(TRUTH[1]);
    expect(n[0]).toBe(TRUTH[0]);
  });
});

describe('the noise model', () => {
  const draw = (make: (r: () => number) => ReturnType<typeof deliveryNoise>, n: number, seed = 5) => {
    const r = rng(seed);
    return Array.from({ length: n }, () => make(r));
  };

  it('has the constants of the plan', () => {
    expect([DELIVERY_SD_M, PIN_SD_M, OUTLIER_RATE, OUTLIER_MIN_M, OUTLIER_MAX_M]).toEqual([10, 4, 0.05, 80, 300]);
  });

  it('shifts a delivery by about 10 m per axis and one in twenty far away', () => {
    const list = draw((r) => deliveryNoise(r, TRUTH), 30000);
    const outliers = list.filter((x) => x.outlier);
    expect(outliers.length / list.length).toBeGreaterThan(0.043);
    expect(outliers.length / list.length).toBeLessThan(0.057);
    for (const o of outliers) {
      expect(o.deviationM).toBeGreaterThanOrEqual(OUTLIER_MIN_M - 0.2);
      expect(o.deviationM).toBeLessThanOrEqual(OUTLIER_MAX_M + 0.2);
    }
    const plain = list.filter((x) => !x.outlier);
    const east = plain.map((x) => distanceM([TRUTH[0], x.point[1]], x.point) * (x.point[0] < TRUTH[0] ? -1 : 1));
    const sd = Math.sqrt(east.reduce((s, v) => s + v * v, 0) / east.length);
    expect(sd).toBeGreaterThan(9.6);
    expect(sd).toBeLessThan(10.4);
    const meanDistance = plain.reduce((s, x) => s + x.deviationM, 0) / plain.length;
    expect(meanDistance).toBeGreaterThan(12.0);
    expect(meanDistance).toBeLessThan(13.1);
  });

  it('reports a deviation that is the real distance', () => {
    for (const x of draw((r) => deliveryNoise(r, TRUTH), 2000)) expect(Math.abs(distanceM(TRUTH, x.point) - x.deviationM)).toBeLessThan(0.2);
  });

  it('reports an accuracy between half and double the real deviation', () => {
    for (const x of draw((r) => deliveryNoise(r, TRUTH), 5000)) {
      expect(x.accuracyM).toBeGreaterThanOrEqual(x.deviationM * 0.5 - 1e-9);
      expect(x.accuracyM).toBeLessThanOrEqual(x.deviationM * 2 + 1e-9);
    }
    const ratios = draw((r) => deliveryNoise(r, TRUTH), 5000).map((x) => x.accuracyM / x.deviationM);
    expect(Math.min(...ratios)).toBeLessThan(0.6);
    expect(Math.max(...ratios)).toBeGreaterThan(1.9);
  });

  it('can leave the outliers out and still uses the same draws', () => {
    const a = draw((r) => deliveryNoise(r, TRUTH, { outliers: false }), 5000);
    expect(a.some((x) => x.outlier)).toBe(false);
    expect(Math.max(...a.map((x) => x.deviationM))).toBeLessThan(80);
    const withOutliers = draw((r) => deliveryNoise(r, TRUTH), 3);
    const without = draw((r) => deliveryNoise(r, TRUTH, { outliers: false }), 3);
    expect(without).toHaveLength(withOutliers.length);
  });

  it('shifts a pin by about 4 m per axis and never far', () => {
    const list = draw((r) => pinNoise(r, TRUTH), 20000);
    expect(list.some((x) => x.outlier)).toBe(false);
    const east = list.map((x) => distanceM([TRUTH[0], x.point[1]], x.point) * (x.point[0] < TRUTH[0] ? -1 : 1));
    const sd = Math.sqrt(east.reduce((s, v) => s + v * v, 0) / east.length);
    expect(sd).toBeGreaterThan(3.85);
    expect(sd).toBeLessThan(4.15);
    expect(Math.max(...list.map((x) => x.deviationM))).toBeLessThan(30);
  });

  it('is repeatable for a seed', () => {
    expect(draw((r) => deliveryNoise(r, TRUTH), 5, 9)).toEqual(draw((r) => deliveryNoise(r, TRUTH), 5, 9));
    expect(draw((r) => pinNoise(r, TRUTH), 5, 9)).toEqual(draw((r) => pinNoise(r, TRUTH), 5, 9));
  });

  it('makes an outlier of the asked distance in a random direction', () => {
    const r = rng(2);
    const list = Array.from({ length: 200 }, () => forcedOutlier(r, TRUTH, 300));
    for (const x of list) {
      expect(Math.abs(distanceM(TRUTH, x.point) - 300)).toBeLessThan(0.3);
      expect(x.outlier).toBe(true);
    }
    expect(list.some((x) => x.point[0] > TRUTH[0])).toBe(true);
    expect(list.some((x) => x.point[0] < TRUTH[0])).toBe(true);
    expect(list.some((x) => x.point[1] > TRUTH[1])).toBe(true);
    expect(list.some((x) => x.point[1] < TRUTH[1])).toBe(true);
  });
});
