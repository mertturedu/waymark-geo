import { distanceM } from '../../src/core/geo/distance';
import { centroidRatio, decideAdoption, encodedSize, indexBuildings, qualifies, snapToBuilding, type Building } from '../../scripts/measure-buildings';

const b = (id: string, lng: number, lat: number, area = 100): Building => ({ id, lng, lat, area });
const east = (lng: number, lat: number, meters: number): [number, number] => [lng + meters / (111_195 * Math.cos((lat * Math.PI) / 180)), lat];

describe('snapToBuilding', () => {
  const here: [number, number] = [29.0, 41.0];

  it('moves the point to the nearest building centre inside thirty metres', () => {
    const near = b('w1', ...east(29.0, 41.0, 12));
    const far = b('w2', ...east(29.0, 41.0, 25));
    const index = indexBuildings([far, near]);
    expect(snapToBuilding(here, index, () => false)).toEqual([near.lng, near.lat]);
  });

  it('leaves the point alone when the nearest building is further than thirty metres', () => {
    const index = indexBuildings([b('w1', ...east(29.0, 41.0, 31))]);
    expect(snapToBuilding(here, index, () => false)).toBeNull();
  });

  it('takes the building at exactly thirty metres and not one a hair further', () => {
    const edge = indexBuildings([b('w1', ...east(29.0, 41.0, 29.99))]);
    expect(snapToBuilding(here, edge, () => false)).not.toBeNull();
    const over = indexBuildings([b('w2', ...east(29.0, 41.0, 30.2))]);
    expect(snapToBuilding(here, over, () => false)).toBeNull();
  });

  it('skips a building that already has a door of its own', () => {
    const taken = b('w1', ...east(29.0, 41.0, 5));
    const free = b('w2', ...east(29.0, 41.0, 20));
    const index = indexBuildings([taken, free]);
    expect(snapToBuilding(here, index, (x) => x.id === 'w1')).toEqual([free.lng, free.lat]);
  });

  it('picks the smaller id when two buildings are equally near', () => {
    const a = b('w2', ...east(29.0, 41.0, 10));
    const c = b('w1', 29.0 - (a.lng - 29.0), 41.0);
    expect(snapToBuilding(here, indexBuildings([a, c]), () => false)).toEqual([c.lng, c.lat]);
  });

  it('finds a building across a cell border', () => {
    const point: [number, number] = [29.0, 41.0];
    const across = b('w1', 28.99999, 41.00001);
    expect(distanceM(point, [across.lng, across.lat])).toBeLessThan(2);
    expect(snapToBuilding(point, indexBuildings([across]), () => false)).toEqual([across.lng, across.lat]);
  });
});

describe('decideAdoption', () => {
  it('adopts on exactly twenty percent smaller median and fifty percent growth', () => {
    expect(decideAdoption({ medianBefore: 10, medianAfter: 8, growthPercent: 50 })).toEqual({ adopt: true, reductionPercent: 20 });
  });

  it('refuses just under the needed gain or just over the growth limit', () => {
    expect(decideAdoption({ medianBefore: 10, medianAfter: 8.01, growthPercent: 10 }).adopt).toBe(false);
    expect(decideAdoption({ medianBefore: 10, medianAfter: 5, growthPercent: 50.01 }).adopt).toBe(false);
  });

  it('refuses when nothing was measured or the median got worse', () => {
    expect(decideAdoption({ medianBefore: 0, medianAfter: 0, growthPercent: 1 }).adopt).toBe(false);
    expect(decideAdoption({ medianBefore: 10, medianAfter: 12, growthPercent: 1 })).toEqual({ adopt: false, reductionPercent: -20 });
  });
});

describe('encodedSize', () => {
  it('is zero for nothing and grows with the number of buildings', () => {
    expect(encodedSize([])).toBe(0);
    const some = Array.from({ length: 100 }, (_, i) => b(`w${i}`, 29.0 + i * 0.0001, 41.0 + (i % 7) * 0.0001));
    expect(encodedSize(some)).toBeGreaterThan(encodedSize(some.slice(0, 50)));
    expect(encodedSize(some) / some.length).toBeLessThan(8);
  });
});

describe('centroidRatio', () => {
  it('is the share of points within three metres of a building centre', () => {
    const index = indexBuildings([b('w1', 29.0, 41.0), b('w2', 29.001, 41.0)]);
    const points: [number, number][] = [[29.0, 41.0], east(29.001, 41.0, 2), east(29.0, 41.0, 10), [29.5, 41.5]];
    expect(centroidRatio(points, index)).toBe(0.5);
    expect(centroidRatio([], index)).toBe(0);
  });
});

describe('qualifies', () => {
  it('lets a province in at exactly half and not a hair under', () => {
    expect(qualifies(0.5)).toBe(true);
    expect(qualifies(0.4999)).toBe(false);
    expect(qualifies(0)).toBe(false);
  });
});
