import { edgeDistanceM, pickAt, pickNear, pointInRing, toInfo, type BuildingInfo } from '../../src/core/address/buildings2';
import { encodeLine } from '../../src/core/region/geom';

const square = (lon: number, lat: number, size: number): [number, number][] => [[lon - size, lat - size], [lon + size, lat - size], [lon + size, lat + size], [lon - size, lat + size]];

const info = (id: number, ring: [number, number][], areaM2: number): BuildingInfo => ({ id, gid: `g${id}`, center: ring[0] as [number, number], areaM2, levels: 3, levelsSource: 'region', heightM: null, name: null, chain: null, part: null, side: null, distanceM: null, along: null, sequence: null, secondChain: null, thirdChain: null, ring });

describe('pointInRing and edgeDistanceM', () => {
  const ring = square(29, 41, 0.0001);

  it('tells inside from outside and measures the distance to the nearest edge', () => {
    expect(pointInRing([29, 41], ring)).toBe(true);
    expect(pointInRing([29.001, 41], ring)).toBe(false);
    expect(edgeDistanceM([29.0002, 41], ring)).toBeGreaterThan(8);
    expect(edgeDistanceM([29.0002, 41], ring)).toBeLessThan(10);
    expect(edgeDistanceM([29, 41.0001], ring)).toBeLessThan(0.5);
  });
});

describe('pickAt', () => {
  const big = info(1, square(29, 41, 0.0004), 5000);
  const small = info(2, square(29, 41, 0.0001), 300);
  const twin = info(3, square(29, 41, 0.0001), 300);

  it('prefers the smallest building that contains the point, ties by id', () => {
    expect(pickAt([big, small], [29, 41], 3)?.id).toBe(2);
    expect(pickAt([twin, small], [29, 41], 3)?.id).toBe(2);
  });

  it('takes the nearest edge within the tolerance and nothing beyond it', () => {
    const a = info(4, square(29, 41, 0.0001), 300);
    const b = info(5, square(29.00025, 41, 0.0001), 300);
    expect(pickAt([a, b], [29.00012, 41], 5)?.id).toBe(4);
    expect(pickAt([b, a], [29.00012, 41], 5)?.id).toBe(4);
    expect(pickAt([a], [29.001, 41], 5)).toBeNull();
    expect(pickAt([], [29, 41], 5)).toBeNull();
  });
});

describe('pickNear', () => {
  it('sorts by distance, inside first, ties by id, and keeps the limit', () => {
    const inside = info(9, square(29, 41, 0.0002), 900);
    const a = info(2, square(29.0006, 41, 0.0001), 300);
    const b = info(1, square(29.0006, 41, 0.0001), 300);
    const far = info(7, square(29.01, 41, 0.0001), 300);
    const found = pickNear([a, b, far, inside], [29, 41], 80, 3);
    expect(found.map((f) => f.building.id)).toEqual([9, 1, 2]);
    expect(found[0]?.distanceM).toBe(0);
    expect(pickNear([a, b, far, inside], [29, 41], 80, 1)).toHaveLength(1);
  });
});

describe('toInfo', () => {
  const ring = square(29, 41, 0.0001);
  const raw = { id: 1, gid: 'g', lon: 29_000_000, lat: 41_000_000, area: 400, ring: encodeLine(ring), levels: 5, lsrc: 3, height: 15, name: 'Blok', chain: 7, comp: 0, side: -1, dist: 123, s: 456, seq: 4, chain2: 8, chain3: null };

  it('maps the stored row to the public shape', () => {
    expect(toInfo(raw)).toMatchObject({ levels: 5, levelsSource: 'height', heightM: 15, side: 'right', distanceM: 12.3, along: 456, sequence: 4, secondChain: 8, thirdChain: null, part: 0 });
    expect(toInfo({ ...raw, side: 1 }).side).toBe('left');
  });

  it('keeps unknown values empty and falls back to the regional source', () => {
    expect(toInfo({ ...raw, side: null, dist: null, chain: null, comp: null, lsrc: 9 })).toMatchObject({ side: null, distanceM: null, chain: null, levelsSource: 'region' });
  });
});
