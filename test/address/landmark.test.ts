import type { BuildingInfo } from '../../src/core/address/buildings2';
import { besideOf, behindOf, cornerOf, oppositeOf, relationOf } from '../../src/core/address/landmark';

const building = (id: number, over: Partial<BuildingInfo> = {}): BuildingInfo => ({ id, gid: `g${id}`, center: [29 + id * 0.0001, 41], areaM2: 300, levels: 4, levelsSource: 'num_floors', heightM: null, name: null, chain: 1, part: 0, side: 'left', distanceM: 10, along: id * 12, sequence: id, secondChain: null, thirdChain: null, ring: [], ...over });

describe('relationOf', () => {
  it('splits the relation word from the landmark and the area', () => {
    expect(relationOf('kipa karsisi bornova')).toEqual({ relation: 'opposite', query: 'kipa bornova' });
    expect(relationOf('migros yaninda nilufer')).toEqual({ relation: 'beside', query: 'migros nilufer' });
    expect(relationOf('hastane arkasinda kadikoy')).toEqual({ relation: 'behind', query: 'hastane kadikoy' });
    expect(relationOf('nurol plaza kosesi')).toEqual({ relation: 'corner', query: 'nurol plaza' });
    expect(relationOf('bahariye caddesi 10 opposite kadikoy')).toEqual({ relation: 'opposite', query: 'bahariye caddesi 10 kadikoy' });
  });

  it('drops "next" before "to" is not needed, and ignores queries without a landmark first', () => {
    expect(relationOf('karsisi bornova')).toBeNull();
    expect(relationOf('yani')).toBeNull();
    expect(relationOf('kipa bornova')).toBeNull();
    expect(relationOf('kipa karsisi')).toEqual({ relation: 'opposite', query: 'kipa' });
  });

  it('removes the word "next" in front of the English form', () => {
    expect(relationOf('hotel next beside park')?.query).toBe('hotel park');
  });
});

describe('oppositeOf', () => {
  const base = building(5, { side: 'left', along: 60 });
  const street = [base, building(6, { side: 'right', along: 66 }), building(7, { side: 'right', along: 40 }), building(8, { side: 'right', along: 300 }), building(9, { side: 'right', along: 62, part: 3 })];

  it('takes the building on the other side nearest along the street', () => {
    expect(oppositeOf(base, street)).toMatchObject({ building: 6, radiusM: 35 });
  });

  it('gives nothing when nothing is across within reach, or the landmark has no position', () => {
    expect(oppositeOf(base, [base, building(8, { side: 'right', along: 300 })])).toBeNull();
    expect(oppositeOf(building(5, { along: null }), street)).toBeNull();
  });
});

describe('besideOf', () => {
  const base = building(5, { along: 60 });
  const street = [base, building(4, { along: 48 }), building(6, { along: 75 }), building(7, { along: 90 }), building(8, { along: 70, side: 'right' })];

  it('lists the next and the previous building on the same side, nearest first', () => {
    expect(besideOf(base, street).map((t) => t.building)).toEqual([4, 6]);
  });

  it('skips neighbours that are too far and handles a missing position', () => {
    expect(besideOf(base, [base, building(9, { along: 500 })])).toEqual([]);
    expect(besideOf(building(5, { along: null }), street)).toEqual([]);
  });
});

describe('cornerOf', () => {
  it('takes the nearest building that touches a second street, the landmark itself first', () => {
    const base = building(5);
    expect(cornerOf(base, [building(6, { secondChain: 2 }), building(7, { secondChain: 3 })])?.building).toBe(6);
    expect(cornerOf(building(5, { secondChain: 2 }), [building(6, { secondChain: 3 })])?.building).toBe(5);
    expect(cornerOf(base, [building(6)])).toBeNull();
    expect(cornerOf(base, [building(60, { secondChain: 2 })])).toBeNull();
  });
});

describe('behindOf', () => {
  it('moves away from the street, from the nearest point on it', () => {
    const base = building(5, { center: [29, 41.0002] });
    const target = behindOf(base, [[[28.99, 41], [29.01, 41]]]);
    expect(target?.radiusM).toBe(60);
    expect(target?.coordinate[1]).toBeGreaterThan(41.0002);
    expect(Math.abs((target?.coordinate[0] ?? 0) - 29)).toBeLessThan(1e-9);
  });

  it('gives nothing without a street or when the building sits on it', () => {
    expect(behindOf(building(5), [])).toBeNull();
    expect(behindOf(building(5, { center: [29, 41] }), [[[28.99, 41], [29.01, 41]]])).toBeNull();
  });
});
