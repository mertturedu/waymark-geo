import type { LngLat } from '../../src/core/geo/cells';
import { aroundOnLine, estimateOnStreet, nearestLine, sideOfLine, voteStreet } from '../../src/core/address/reverse-street';

const M = 111_320;
const line: LngLat[] = [[29, 41], [29.02, 41]];
const at = (eastM: number, northM: number): LngLat => [29 + eastM / (M * Math.cos((41 * Math.PI) / 180)), 41 + northM / M];

describe('sideOfLine', () => {
  it('tells the left of the line direction from the right', () => {
    expect(sideOfLine(at(300, 20), line)).toBe('left');
    expect(sideOfLine(at(300, -20), line)).toBe('right');
    expect(sideOfLine(at(300, 20), [[29, 41]])).toBe('left');
  });
});

describe('nearestLine', () => {
  it('picks the closest line and skips lines with one point', () => {
    const far: LngLat[] = [[29, 41.01], [29.02, 41.01]];
    expect(nearestLine(at(100, 10), [far, line, [[29, 41]]])?.line).toBe(line);
    expect(nearestLine(at(100, 10), [[[29, 41]]])).toBeNull();
  });
});

describe('estimateOnStreet', () => {
  const door = (number: number, eastM: number, northM: number) => ({ number, point: at(eastM, northM) });
  const left = [door(1, 0, 15), door(3, 40, 15), door(5, 80, 15), door(9, 160, 15)];
  const right = [door(2, 0, -15), door(4, 40, -15), door(8, 120, -15)];

  it('interpolates between the doors on the same side and snaps to the side parity', () => {
    const found = estimateOnStreet(at(120, 18), line, [...left, ...right]);
    expect(found).toMatchObject({ number: 7, parity: 1, side: 'left', slope: 1 });
    expect(found?.low).toBeLessThanOrEqual(7);
    expect(found?.high).toBeGreaterThanOrEqual(7);
    expect(estimateOnStreet(at(100, -18), line, [...left, ...right])).toMatchObject({ number: 8, parity: 0, side: 'right' });
  });

  it('extends past the last door with the spacing of the doors', () => {
    const found = estimateOnStreet(at(240, 18), line, left);
    expect(found?.number).toBeGreaterThan(9);
    expect(found?.number).toBeLessThanOrEqual(17);
    const before = estimateOnStreet(at(-40, 18), line, left);
    expect(before?.number).toBe(1);
  });

  it('follows numbers that fall along the line and takes the parity from the other side when this side has none', () => {
    const down = [door(9, 0, 15), door(7, 40, 15), door(5, 80, 15), door(3, 160, 15)];
    expect(estimateOnStreet(at(120, 18), line, down)).toMatchObject({ slope: -1, parity: 1, side: 'left' });
    const oneSide = estimateOnStreet(at(60, -18), line, left);
    expect(oneSide).toMatchObject({ parity: 0, side: 'right' });
  });

  it('gives nothing without doors near the street, parity evidence or a line', () => {
    expect(estimateOnStreet(at(60, 18), line, [])).toBeNull();
    expect(estimateOnStreet(at(60, 18), line, [door(3, 40, 300)])).toBeNull();
    expect(estimateOnStreet(at(60, 18), line, [door(3, 40, 15), door(4, 41, 15)])).toBeNull();
    expect(estimateOnStreet(at(60, 18), [[29, 41]], left)).toBeNull();
  });

  it('uses a default spacing for a single door and keeps even numbers at 2 or more', () => {
    const one = estimateOnStreet(at(300, -18), line, [door(2, 0, -15)]);
    expect(one?.number).toBeGreaterThanOrEqual(2);
    expect(one?.number).toBe(one && one.number % 2 === 0 ? one.number : 0);
  });
});

describe('voteStreet', () => {
  const rows = (ids: (number | null)[]): { streetId: number | null; point: LngLat }[] => ids.map((streetId, i) => ({ streetId, point: at(10 + i, 0) }));

  it('keeps the building chain unless the other candidate has the doors', () => {
    expect(voteStreet(at(0, 0), rows([2, 2]), [1, 2, null])).toBe(1);
    expect(voteStreet(at(0, 0), rows([2, 2, 2, 2, 2, 2, 2, 2]), [1, 2, null])).toBe(2);
    expect(voteStreet(at(0, 0), rows([3, 3]), [1, null, null])).toBe(1);
  });

  it('ignores doors that are too far or of other streets, and votes by doors when there is no chain', () => {
    const far = [{ streetId: 2, point: at(500, 0) }];
    expect(voteStreet(at(0, 0), far, [1, 2, null])).toBe(1);
    expect(voteStreet(at(0, 0), rows([5, 5, 6, null]), [null, null, null])).toBe(5);
    expect(voteStreet(at(0, 0), [], [null, null, null])).toBeNull();
    expect(voteStreet(at(0, 0), rows([7, 8]), [null, null, null])).toBe(7);
  });
});

describe('aroundOnLine', () => {
  const b = (id: number, eastM: number, northM = 20): { id: number; center: LngLat } => ({ id, center: at(eastM, northM) });

  it('lists up to two buildings each way on the same side with their numbers', () => {
    const estimate = { number: 7, low: 5, high: 9, parity: 1 as const, side: 'left' as const, anchors: 3, slope: 1 as const };
    const out = aroundOnLine(b(5, 100), [b(1, 20), b(2, 60), b(3, 100), b(4, 140), b(6, 180), b(7, 100, -20), b(8, 100, 200)], line, estimate);
    expect(out.map((o) => [o.offset, o.number])).toEqual([[-2, '3'], [-1, '5'], [1, '9'], [2, '11']]);
    expect(out[1]?.coordinate).toEqual(at(60, 20));
  });

  it('leaves the numbers out without an estimate, skips missing neighbours and numbers below 1', () => {
    const none = aroundOnLine(b(5, 100), [b(4, 60)], line, null);
    expect(none).toEqual([{ offset: -1, coordinate: at(60, 20), number: null }]);
    const low = aroundOnLine(b(5, 100), [b(4, 60), b(3, 20)], line, { number: 3, low: 1, high: 5, parity: 1, side: 'left', anchors: 1, slope: 1 });
    expect(low.map((o) => o.number)).toEqual([null, '1']);
  });
});
