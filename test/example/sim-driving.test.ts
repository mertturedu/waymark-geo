import { along, destination, distance, easeBearing, heading, joinLegs, lineLength, ring, turnBetween, type Point } from '../../example/src/sdk-test/sim/driving';

const A: Point = [29.0, 41.0];

describe('driving simulation helpers', () => {
  it('measures distance and heading', () => {
    const north = destination(A, 0, 1000);
    expect(distance(A, north)).toBeCloseTo(1000, 0);
    expect(heading(A, north)).toBeCloseTo(0, 1);
    expect(heading(A, destination(A, 90, 500))).toBeCloseTo(90, 1);
    expect(heading(A, destination(A, 225, 500))).toBeCloseTo(225, 1);
  });

  it('turns the short way round', () => {
    expect(turnBetween(350, 10)).toBe(20);
    expect(turnBetween(10, 350)).toBe(-20);
    expect(turnBetween(0, 180)).toBe(-180);
    expect(easeBearing(350, 90, 30)).toBeCloseTo(20, 5);
    expect(easeBearing(10, 300, 30)).toBeCloseTo(340, 5);
    expect(easeBearing(90, 100, 30)).toBeCloseTo(100, 5);
  });

  it('samples a line at an even spacing and keeps the end', () => {
    const line: Point[] = [A, destination(A, 90, 1000), destination(destination(A, 90, 1000), 0, 500)];
    const samples = along(line, 50);
    expect(samples[0]!.at).toBe(0);
    expect(samples[samples.length - 1]!.at).toBeCloseTo(1500, 0);
    expect(distance(samples[samples.length - 1]!.point, line[2]!)).toBeLessThan(1);
    const gaps = samples.slice(1, -1).map((s, i) => distance(samples[i]!.point, s.point));
    expect(Math.max(...gaps)).toBeLessThan(51);
    expect(Math.min(...gaps)).toBeGreaterThan(30);
    expect(samples[3]!.heading).toBeCloseTo(90, 0);
    expect(samples[samples.length - 3]!.heading).toBeCloseTo(0, 0);
  });

  it('does not sample a degenerate line', () => {
    expect(along([A], 50)).toEqual([]);
    expect(along([A, A], 50).length).toBeLessThanOrEqual(1);
  });

  it('places automatic points on a ring', () => {
    const points = ring(A, 3000, 12, 15);
    expect(points).toHaveLength(12);
    for (const point of points) expect(distance(A, point)).toBeCloseTo(3000, -1);
    expect(distance(points[0]!, points[6]!)).toBeCloseTo(6000, -1);
    expect(heading(A, points[0]!)).toBeCloseTo(15, 0);
  });

  it('joins legs without repeating the shared point', () => {
    const b = destination(A, 0, 100);
    const c = destination(b, 0, 100);
    expect(joinLegs([[A, b], [b, c]])).toEqual([A, b, c]);
    expect(lineLength(joinLegs([[A, b], [b, c]]))).toBeCloseTo(200, 0);
  });
});
