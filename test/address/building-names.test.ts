import { buildingPlace, buildingsByName, isTwin } from '../../src/core/address/building-names';
import type { BuildingInfo } from '../../src/core/address/buildings2';
import type { RegionContext, Scored } from '../../src/core/address/resolve';
import type { Place } from '../../src/core/address/types';
import type { Polygon } from '../../src/core/region/geom';
import { parseAddress } from '../../src/core/text/parse';

const square = (west: number, south: number, east: number, north: number): Polygon => [[[west, south], [east, south], [east, north], [west, north], [west, south]]] as unknown as Polygon;

const building = (id: number, name: string | null, lon: number, lat: number, chain: number | null = 7): BuildingInfo =>
  ({ id, gid: `g${id}`, center: [lon, lat], areaM2: 200, levels: 4, levelsSource: 'osm', heightM: null, name, chain, part: null, side: null, distanceM: null, along: null, sequence: null, secondChain: null, thirdChain: null, ring: [] }) as BuildingInfo;

const KEEP = [building(1, 'Dadaş Plaza', 29.0, 41.0), building(2, 'Dadaş Plaza', 29.0, 41.01, null), building(3, 'Dadaş Sitesi', 20, 30), building(4, 'Dadaş Plaza', 29.5, 41.5)];

function context(over: { buildings?: BuildingInfo[]; reader?: boolean } = {}): RegionContext {
  const list = over.buildings ?? KEEP;
  const keyOf = (name: string | null): string => (name ?? '').toLowerCase().replace(/ş/g, 's').replace(/ı/g, 'i');
  const reader = { named: async (prefix: string) => list.filter((b) => keyOf(b.name).startsWith(prefix)).map((b) => ({ key: keyOf(b.name), building: b })) };
  return {
    region: {
      id: '34',
      districts: [{ id: 1, name: 'Kadıköy', key: 'kadikoy', center: [29, 41] }, { id: 2, name: 'Üsküdar', key: 'uskudar', center: [29.5, 41.5] }],
      hoods: [],
      districtPolygons: async () => new Map([[1, [square(28.9, 40.9, 29.2, 41.2)]], [2, [square(29.4, 41.4, 29.6, 41.6)]]]),
      hoodPolygons: async () => new Map(),
      streetsByIds: async () => [{ id: 7, name: 'Papatya Sokağı', key: 'papatya sokagi', kind: null, number: null }],
    },
    provinceName: 'İstanbul',
    official: new Map([[1, null], [2, null]]),
    layers: [],
    language: 'tr',
    findDistrictId: () => null,
    ...(over.reader === false ? {} : { buildings2: reader as never }),
  } as unknown as RegionContext;
}

const asked = (text: string) => parseAddress(text);
const poi = (name: string, lon: number, lat: number): Scored => ({ place: { id: 'o', label: '', components: { poiName: name }, coordinate: [lon, lat], precision: 'poi', approximate: false, source: 'osm', confidence: 1, region: '34' } as Place, score: 1, area: '1/0' });

describe('buildingsByName', () => {
  it('gives the buildings of that name with their street and district, best first', async () => {
    const found = await buildingsByName(context(), asked('Dadaş Plaza Kadıköy'));
    expect(found.map((s) => s.place.id)).toEqual(['34:b:1', '34:b:2', '34:b:4']);
    expect(found[0]?.place).toMatchObject({ precision: 'poi', components: { poiName: 'Dadaş Plaza', street: 'Papatya Sokağı', district: 'Kadıköy' } });
    expect(found[1]?.place.components.street).toBeUndefined();
    expect(found[2]?.score).toBeLessThan((found[0] as Scored).score);
  });

  it('leaves out a building outside every district, a name too short or unlike and a context without the part', async () => {
    expect((await buildingsByName(context(), asked('Dadaş Sitesi'))).map((s) => s.place.id)).not.toContain('34:b:3');
    expect(await buildingsByName(context(), asked('Da'))).toEqual([]);
    expect(await buildingsByName(context(), asked('Dadaş Hastanesi Merkezi'))).toEqual([]);
    expect(await buildingsByName(context({ reader: false }), asked('Dadaş Plaza'))).toEqual([]);
  });

  it('skips a building that is the same place as one already known', async () => {
    const known = [poi('Dadaş Plaza', 29.0001, 41.0001)];
    expect((await buildingsByName(context(), asked('Dadaş Plaza Kadıköy'), known)).map((s) => s.place.id)).toEqual(['34:b:2', '34:b:4']);
    expect(isTwin(known, 'dadas plaza', building(9, 'x', 29.5, 41.5))).toBe(false);
    expect(isTwin([poi('Başka', 29, 41)], 'dadas plaza', building(9, 'x', 29, 41))).toBe(false);
  });

  it('keeps a district word that is part of the name and finds a name with a misspelt start', async () => {
    const own = [building(11, 'Kadıköy Plaza', 29.0, 41.0)];
    expect((await buildingsByName(context({ buildings: own }), asked('Kadıköy Plaza Kadıköy'))).map((s) => s.place.id)).toEqual(['34:b:11']);
    expect((await buildingsByName(context({ buildings: own }), asked('Kadikoy Plasa İstanbul'))).map((s) => s.place.id)).toEqual(['34:b:11']);
    expect((await buildingsByName(context(), asked('Dadsa Plaza Kadıköy'))).map((s) => s.place.id)).toContain('34:b:1');
    expect(await buildingsByName(context(), asked('Xyzabc Plaza Kadıköy'))).toEqual([]);
  });

  it('builds a place with the key as name when the building has none', async () => {
    const polygons = await context().region.districtPolygons();
    const place = await buildingPlace(context(), polygons, building(5, null, 29.05, 41.05), 'dadas plaza', 0.8, null);
    expect(place?.place.components.poiName).toBe('dadas plaza');
    expect(await buildingPlace(context(), polygons, building(6, 'x', 10, 10), 'x', 0.8, null)).toBeNull();
    expect((await buildingPlace(context(), polygons, building(7, 'x', 29.05, 41.05), 'x', 1, new Set([2])))?.score).toBeLessThan(1);
    expect((await buildingPlace(context(), polygons, building(8, 'x', 29.05, 41.05), 'x', 1, new Set()))?.score).toBe(1);
  });
});
