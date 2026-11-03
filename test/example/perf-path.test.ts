import { panPath } from '../../example/src/sdk-test/tests/pan-path';
import { distanceM } from '../../src/core/geo/distance';

describe('panPath', () => {
  it('moves the given distance at every step and comes back near the start', () => {
    const start: [number, number] = [29.0275, 40.9878];
    const path = panPath(start, 8, 350);
    expect(path).toHaveLength(8);
    let previous = start;
    for (const point of path) {
      expect(Math.abs(distanceM(previous, point) - 350)).toBeLessThan(5);
      previous = point;
    }
    expect(distanceM(start, path[7]!)).toBeLessThan(5);
  });
});
