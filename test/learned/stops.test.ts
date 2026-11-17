import { chooseStop, deliveryStop, entranceCandidate, findStops, stopPoint, type TracePoint } from '../../src/core/learned/stops';
import { distanceM } from '../../src/core/geo/distance';
import type { LngLat } from '../../src/core/geo/cells';
import { moveBy } from '../sim/noise';
import { rng } from '../sim/random';
import { walkFor } from '../sim/walks';

const HOME: LngLat = [29, 41];
const at = (east: number, north: number, t: number, speed: number | null = 0, accuracyM = 6): TracePoint => {
  const p = moveBy(HOME, east, north);
  return { lng: p[0], lat: p[1], accuracyM, speed, t };
};

describe('findStops', () => {
  it('finds a stationary run and ignores walking', () => {
    const trace = [at(-60, 0, 30, 1.4), at(-40, 0, 27, 1.4), at(-20, 0, 24, 1.4), at(0, 0, 21, 0.2), at(0.5, 0, 18, 0.1), at(-0.4, 0.3, 15, 0), at(0.2, 0, 12, 0)];
    const stops = findStops(trace);
    expect(stops).toHaveLength(1);
    expect(distanceM(stops[0]?.point as LngLat, HOME)).toBeLessThan(2);
    expect(stops[0]).toMatchObject({ seconds: 9, samples: 4, endsBefore: 12 });
  });

  it('derives the speed from positions when the device gives none', () => {
    const trace = [at(-30, 0, 24, null), at(-20, 0, 21, null), at(-10, 0, 18, null), at(0, 0, 15, null), at(0.3, 0, 12, null), at(0, 0.2, 9, null)];
    const stops = findStops(trace);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.samples).toBe(3);
  });

  it('needs two samples and three seconds, and drops poor fixes and unsorted input', () => {
    expect(findStops([at(0, 0, 10, 0), at(0, 0, 9, 0)])).toEqual([]);
    expect(findStops([at(0, 0, 10, 0), at(0, 0, 4, 0, 80)])).toEqual([]);
    expect(findStops([at(0, 0, 6, 0), at(0.2, 0, 12, 0), at(0, 0.2, 9, 0)])).toHaveLength(1);
    expect(findStops([{ ...at(0, 0, 10, 0), lng: Number.NaN }, at(0, 0, 5, 0)])).toEqual([]);
    expect(findStops([])).toEqual([]);
  });

  it('splits two stops that are further apart than the jitter of one', () => {
    const trace = [at(0, 0, 40, 0), at(0.3, 0, 37, 0), at(0, 0.2, 34, 0), at(50, 0, 31, 0), at(50.3, 0, 28, 0), at(50, 0.3, 25, 0)];
    expect(findStops(trace).map((s) => Math.round(distanceM(s.point, HOME)))).toEqual([0, 50]);
  });

  it('weights a run by the accuracy of its fixes', () => {
    const run = [at(0, 0, 12, 0, 4), at(0, 0, 9, 0, 4), at(8, 0, 6, 0, 20)];
    expect(distanceM(findStops(run)[0]?.point as LngLat, HOME)).toBeLessThan(1);
  });
});

describe('chooseStop', () => {
  const door = { point: HOME, seconds: 12, samples: 5, endsBefore: 5, accuracyM: 4 };
  const car = { point: moveBy(HOME, 45, 0), seconds: 8, samples: 3, endsBefore: 1, accuracyM: 4 };
  const far = { point: moveBy(HOME, 300, 0), seconds: 30, samples: 10, endsBefore: 40, accuracyM: 4 };

  it('takes the stop nearest to the references, not the latest one', () => {
    expect(chooseStop([door, car, far], { points: [HOME] })).toBe(door);
    expect(chooseStop([door, car], { points: [moveBy(HOME, 40, 0)] })).toBe(car);
  });

  it('gives nothing when no stop is within reach of the references', () => {
    expect(chooseStop([far], { points: [HOME] })).toBeNull();
    expect(chooseStop([far], { points: [HOME], reachM: 400 })).toBe(far);
  });

  it('lets a long stop win over a slightly nearer short one', () => {
    const near = { ...door, point: moveBy(HOME, 2, 0), seconds: 3 };
    const longer = { ...door, point: moveBy(HOME, 6, 0), seconds: 20 };
    expect(chooseStop([near, longer], { points: [HOME] })).toBe(longer);
  });

  it('without references, takes a stop of the last minute and only that', () => {
    expect(chooseStop([door, far])).toBe(door);
    expect(chooseStop([{ ...far, endsBefore: 200 }])).toBeNull();
  });

  it('uses a street line as the reference and keeps the stops on the right side of it', () => {
    const line: LngLat[] = [moveBy(HOME, -50, -10), moveBy(HOME, 50, -10)];
    const left = { ...door, point: moveBy(HOME, 0, 0) };
    const right = { ...door, point: moveBy(HOME, 0, -20), endsBefore: 3 };
    expect(chooseStop([left, right], { line, side: 'left' })).toBe(left);
    expect(chooseStop([left, right], { line, side: 'right' })).toBe(right);
    expect(chooseStop([left], { line: [line[0] as LngLat], side: 'right' })).toBe(left);
  });

  it('keeps only the stops on the door side without taking the line as a reference', () => {
    const line: LngLat[] = [moveBy(HOME, -50, -10), moveBy(HOME, 50, -10)];
    const doorSide = { ...door, point: moveBy(HOME, 0, 0) };
    const across = { ...door, point: moveBy(HOME, 0, -20) };
    const pin = [moveBy(HOME, 0, -12)];
    expect(chooseStop([doorSide, across], { points: pin })).toBe(across);
    expect(chooseStop([doorSide, across], { points: pin, onSide: { line, side: 'left' } })).toBe(doorSide);
    expect(chooseStop([doorSide, across], { points: pin, onSide: { line: [line[0] as LngLat], side: 'left' } })).toBe(across);
  });

  it('gives nothing for an empty list', () => {
    expect(chooseStop([], { points: [HOME] })).toBeNull();
  });
});

describe('deliveryStop', () => {
  const run = (east: number, t0: number): TracePoint[] => [at(east, 0, t0), at(east + 0.3, 0, t0 - 3), at(east, 0.2, t0 - 6)];
  const trace = [...run(0, 40), ...run(45, 20)];

  it('goes by the pin and the map point first, so a stop at the car does not win', () => {
    const near = distanceM(deliveryStop(trace, [HOME], { lng: moveBy(HOME, 45, 0)[0], lat: HOME[1] })?.point as LngLat, HOME);
    expect(near).toBeLessThan(2);
  });

  it('falls back to the confirm point when the pin is wrong, and to nothing when that does not help', () => {
    const wrongPin = moveBy(HOME, 400, 0);
    const confirm = { lng: moveBy(HOME, 45, 0)[0], lat: HOME[1] };
    expect(distanceM(deliveryStop(trace, [wrongPin], confirm)?.point as LngLat, moveBy(HOME, 45, 0))).toBeLessThan(2);
    expect(deliveryStop(trace, [wrongPin])).toBeNull();
    expect(deliveryStop(trace, [wrongPin], { lng: 30, lat: 42 })).toBeNull();
  });

  it('prefers a stop on the door side and falls back when none is there', () => {
    const line: LngLat[] = [moveBy(HOME, -50, -10), moveBy(HOME, 50, -10)];
    const mixed = [...run(0, 40), ...[at(0, -20, 20), at(0.3, -20, 17), at(0, -20.2, 14)]];
    const pin = [moveBy(HOME, 0, -12)];
    expect(distanceM(deliveryStop(mixed, pin, undefined, { line, side: 'left' })?.point as LngLat, HOME)).toBeLessThan(2);
    expect(distanceM(deliveryStop(mixed, pin)?.point as LngLat, moveBy(HOME, 0, -20))).toBeLessThan(2);
    expect(distanceM(deliveryStop(mixed.slice(3), pin, undefined, { line, side: 'left' })?.point as LngLat, moveBy(HOME, 0, -20))).toBeLessThan(2);
    expect(distanceM(deliveryStop(mixed, [moveBy(HOME, 400, 0)], { lng: pin[0]![0], lat: pin[0]![1] }, { line, side: 'left' })?.point as LngLat, HOME)).toBeLessThan(2);
    expect(distanceM(deliveryStop(mixed, [], undefined, { line, side: 'left' })?.point as LngLat, HOME)).toBeLessThan(2);
    expect(distanceM(deliveryStop(mixed, [])?.point as LngLat, moveBy(HOME, 0, -20))).toBeLessThan(2);
  });

  it('chooses freely by time when there is no reference at all', () => {
    expect(distanceM(deliveryStop(trace, [])?.point as LngLat, moveBy(HOME, 45, 0))).toBeLessThan(2);
    expect(deliveryStop([], [])).toBeNull();
  });
});

describe('entranceCandidate', () => {
  it('offers the stop as an entrance only when it is next to the building', () => {
    const stop = { point: HOME, seconds: 10, samples: 4, endsBefore: 3, accuracyM: 4 };
    expect(entranceCandidate(stop, 6)).toEqual(HOME);
    expect(entranceCandidate(stop, 40)).toBeNull();
  });
});

describe('on simulated walks', () => {
  it('finds the door stop whether the courier taps at the door, after leaving or back at the car', () => {
    const rand = rng(14);
    for (const tap of ['door', 'after', 'car'] as const) {
      let found = 0;
      const errors: number[] = [];
      for (let i = 0; i < 60; i++) {
        const walk = walkFor(rand, { truth: HOME, tap, traffic: i % 2 === 0 });
        const stop = stopPoint(walk.trace, { points: [HOME] });
        if (!stop) continue;
        found++;
        errors.push(distanceM(stop.point, HOME));
      }
      errors.sort((a, b) => a - b);
      expect(found).toBeGreaterThan(tap === 'door' ? 40 : 50);
      expect(errors[Math.floor(errors.length / 2)] as number).toBeLessThan(8);
    }
  });
});
