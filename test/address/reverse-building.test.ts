import type { BuildingInfo } from '../../src/core/address/buildings2';
import type { AddressRow } from '../../src/core/address/pack';
import { bearingDeg, chooseBuilding, lowAccuracy, ownedDoor, reachFor } from '../../src/core/address/reverse-building';

const building = (id: number, over: Partial<BuildingInfo> = {}): BuildingInfo => ({ id, gid: `g${id}`, center: [29, 41.0002], areaM2: 200, levels: 4, levelsSource: 'region', heightM: null, name: null, chain: 1, part: 0, side: 'left', distanceM: 10, along: 10, sequence: 1, secondChain: null, thirdChain: null, ring: [], ...over });
const row = (id: number, lng: number, lat: number): AddressRow => ({ id, streetId: 1, districtId: 1, hoodId: 1, place: null, number: String(id), nkey: String(id), num: id, suffix: '', parity: id % 2, lng, lat, osm: 1, postcode: null });

describe('reachFor and lowAccuracy', () => {
  it('widens the reach to the GPS accuracy up to a limit and flags a poor fix', () => {
    expect(reachFor(undefined)).toBe(25);
    expect(reachFor(10)).toBe(25);
    expect(reachFor(40)).toBe(40);
    expect(reachFor(500)).toBe(60);
    expect(reachFor(Number.NaN)).toBe(25);
    expect(lowAccuracy(80)).toBe(true);
    expect(lowAccuracy(20)).toBe(false);
    expect(lowAccuracy(undefined)).toBe(false);
  });
});

describe('bearingDeg', () => {
  it('measures the compass bearing from one point to another', () => {
    expect(Math.round(bearingDeg([29, 41], [29, 41.001]))).toBe(0);
    expect(Math.round(bearingDeg([29, 41], [29.001, 41]))).toBe(90);
    expect(Math.round(bearingDeg([29, 41], [29, 40.999]))).toBe(180);
    expect(Math.round(bearingDeg([29, 41], [28.999, 41]))).toBe(270);
  });
});

describe('chooseBuilding', () => {
  const point: [number, number] = [29, 41];
  const north = building(1, { center: [29, 41.0002] });
  const south = building(2, { center: [29, 40.9998] });

  it('takes the building the point is in, else the nearest', () => {
    expect(chooseBuilding(point, south, [{ building: north, distanceM: 5 }])?.id).toBe(2);
    expect(chooseBuilding(point, null, [{ building: north, distanceM: 12 }, { building: south, distanceM: 8 }])?.id).toBe(2);
    expect(chooseBuilding(point, null, [])).toBeNull();
  });

  it('prefers the building ahead when the heading is known, but not a much nearer one behind it by a lot', () => {
    const near = [{ building: north, distanceM: 12 }, { building: south, distanceM: 8 }];
    expect(chooseBuilding(point, null, near, 0)?.id).toBe(1);
    expect(chooseBuilding(point, null, near, 180)?.id).toBe(2);
    expect(chooseBuilding(point, null, [{ building: north, distanceM: 40 }, { building: south, distanceM: 8 }], 0)?.id).toBe(2);
    expect(chooseBuilding(point, null, near, Number.NaN)?.id).toBe(2);
    expect(chooseBuilding(point, null, [{ building: building(9), distanceM: 8 }, { building: building(3), distanceM: 8 }])?.id).toBe(3);
  });
});

describe('ownedDoor', () => {
  const ring: [number, number][] = [[29, 41], [29.0002, 41], [29.0002, 41.0002], [29, 41.0002], [29, 41]];
  const home = building(1, { center: [29.0001, 41.0001], ring });

  it('owns a door on the building and picks the one nearest the point', () => {
    const rows = [row(7, 29, 41.0001), row(8, 29.00001, 41.00012), row(9, 29.01, 41.01), row(6, 29.0001, 41.0001)];
    expect(ownedDoor(rows, home, [29.00001, 41.00011])?.id).toBe(8);
    expect(ownedDoor([row(9, 29.01, 41.01)], home, [29, 41])).toBeNull();
  });

  it('measures from the centre when the building has no outline and breaks ties by id', () => {
    const bare = building(2, { center: [29, 41], ring: [] });
    expect(ownedDoor([row(5, 29.00001, 41), row(4, 29.00001, 41)], bare, [29, 41])?.id).toBe(4);
    expect(ownedDoor([row(5, 29.001, 41)], bare, [29, 41])).toBeNull();
  });
});
