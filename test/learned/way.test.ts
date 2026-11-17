import { wayPoint } from '../../src/core/learned/way';
import type { StreetWay } from '../../src/core/learned/types';

const metres = (point: [number, number]): number => (point[0] - 29) * 111320 * Math.cos((41 * Math.PI) / 180);

const way: StreetWay = {
  line: [[29, 41], [29.01, 41]],
  doors: [[2, 100], [4, 300], [6, 500], [8, 700], [1, 100], [3, 300], [5, 500], [7, 700]],
};

describe('wayPoint', () => {
  it('interpolates between the nearest numbers of the same side', () => {
    expect(Math.abs(metres(wayPoint(way, 5)!) - 500)).toBeLessThan(5);
  });

  it('interpolates inside a gap and clamps outside the known range', () => {
    const inside = wayPoint({ ...way, doors: [[2, 100], [10, 500], [12, 600], [14, 700]] }, 6)!;
    expect(Math.abs(metres(inside) - 300)).toBeLessThan(5);
    expect(Math.abs(metres(wayPoint(way, 99)!) - 700)).toBeLessThan(5);
  });

  it('needs at least four samples and a real line', () => {
    expect(wayPoint({ line: way.line, doors: [[1, 0], [2, 10], [3, 20]] }, 2)).toBeNull();
    expect(wayPoint({ line: [[29, 41], [29, 41]], doors: way.doors }, 2)).toBeNull();
  });

  it('clamps below the known range, ignores parity when one side has too few samples and handles repeated line points', () => {
    expect(Math.abs(metres(wayPoint(way, 0)!) - 100)).toBeLessThan(5);
    const oddOnly = wayPoint({ line: way.line, doors: [[1, 100], [3, 300], [5, 500], [7, 700]] }, 4)!;
    expect(Math.abs(metres(oddOnly) - 300)).toBeLessThan(120);
    const repeated = wayPoint({ line: [[29, 41], [29, 41], [29.01, 41]], doors: way.doors }, 5)!;
    expect(Math.abs(metres(repeated) - 500)).toBeLessThan(5);
  });

  it('answers the same for two numbers at one position', () => {
    const same = wayPoint({ line: way.line, doors: [[2, 100], [4, 100], [6, 300], [8, 700]] }, 4)!;
    expect(Math.abs(metres(same) - 100)).toBeLessThan(5);
  });
});
