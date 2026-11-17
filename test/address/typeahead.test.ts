import type { BuildingInfo, Buildings2 } from '../../src/core/address/buildings2';
import type { AddressRow, NameHit, Region } from '../../src/core/address/pack';
import type { Place } from '../../src/core/address/types';
import { completionOf, createTypeSession, knownNumbers, recentsAsPlaces, sessionRegion, unitHintFor } from '../../src/core/address/typeahead';

const hit = (key: string, ref = 1): NameHit => ({ nameId: ref, ref, lang: 'tr', key, name: key });
const place = (over: Partial<Place> = {}): Place => ({ id: 'p', label: 'x', components: {}, coordinate: [29, 41], precision: 'address', approximate: false, source: 'osm', confidence: 1, region: '34', ...over });
const row = (id: number, num: number, over: Partial<AddressRow> = {}): AddressRow => ({ id, streetId: 1, districtId: 1, hoodId: 1, place: null, number: String(num), nkey: String(num), num, suffix: '', parity: num % 2, lng: 29, lat: 41, osm: 1, postcode: null, ...over });

describe('sessionRegion', () => {
  function fake(names: NameHit[], calls: string[]): Region {
    return {
      id: '34',
      db: {},
      prefixNames: async (kind: string, prefix: string, limit: number) => { calls.push(`${kind}:${prefix}`); return names.filter((n) => n.key.startsWith(prefix)).slice(0, limit); },
      streetsByIds: async (ids: number[]) => { calls.push(`s:${ids}`); return ids.map((id) => ({ id, name: `s${id}`, key: `s${id}`, kind: null, number: null })); },
      hoodsOfStreet: async (ids: number[]) => { calls.push(`h:${ids}`); return []; },
      poisByIds: async (ids: number[]) => { calls.push(`p:${ids}`); return []; },
      streetsOfHood: async (hood: number, limit: number) => { calls.push(`o:${hood}:${limit}`); return [{ streetId: 1, doors: 2 }]; },
    } as unknown as Region;
  }

  it('answers a longer prefix from the earlier hits when those were not cut off', async () => {
    const calls: string[] = [];
    const region = sessionRegion(fake([hit('papatya'), hit('papaya'), hit('palmiye', 2)], calls), createTypeSession());
    expect((await region.prefixNames('street', 'pa', 10)).map((h) => h.key)).toEqual(['papatya', 'papaya', 'palmiye']);
    expect((await region.prefixNames('street', 'pap', 10)).map((h) => h.key)).toEqual(['papatya', 'papaya']);
    expect((await region.prefixNames('street', 'papat', 10)).map((h) => h.key)).toEqual(['papatya']);
    expect(calls).toEqual(['street:pa']);
  });

  it('asks again when the first answer was cut off, the prefix changed or the limit grew', async () => {
    const calls: string[] = [];
    const region = sessionRegion(fake([hit('papatya'), hit('papaya'), hit('palmiye', 2)], calls), createTypeSession());
    await region.prefixNames('street', 'pa', 2);
    await region.prefixNames('street', 'pap', 2);
    await region.prefixNames('poi', 'pap', 2);
    await region.prefixNames('poi', 'pa', 2);
    await region.prefixNames('poi', 'pa', 5);
    expect(calls).toEqual(['street:pa', 'street:pap', 'poi:pap', 'poi:pa', 'poi:pa']);
  });

  it('keeps the same wrapper for a region and remembers street, hood and place lookups', async () => {
    const calls: string[] = [];
    const session = createTypeSession();
    const raw = fake([], calls);
    const region = sessionRegion(raw, session);
    expect(sessionRegion(raw, session)).toBe(region);
    await region.streetsByIds([1, 2]);
    await region.streetsByIds([1, 2]);
    await region.hoodsOfStreet([1]);
    await region.hoodsOfStreet([1]);
    await region.poisByIds([4]);
    await region.poisByIds([4]);
    await region.streetsOfHood?.(3, 5);
    await region.streetsOfHood?.(3, 5);
    expect(calls).toEqual(['s:1,2', 'h:1', 'p:4', 'o:3:5']);
  });

  it('forgets everything it holds once the memory fills up', async () => {
    const calls: string[] = [];
    const region = sessionRegion(fake([], calls), createTypeSession());
    for (let i = 0; i < 205; i++) await region.streetsByIds([i]);
    await region.streetsByIds([204]);
    await region.streetsByIds([0]);
    expect(calls.filter((c) => c === 's:0')).toHaveLength(2);
    const plain = { ...fake([], calls), streetsOfHood: undefined } as unknown as Region;
    expect(sessionRegion(plain, createTypeSession()).streetsOfHood).toBeUndefined();
  });
});

describe('knownNumbers', () => {
  const rows = [row(1, 2), row(2, 20), row(3, 22), row(4, 200), row(5, 21, { suffix: 'A' }), row(6, 24, { hoodId: 2 }), row(7, 28), row(8, 25, { districtId: 2 })];

  it('lists the doors that start with the typed digits, nearest number first, in the same place only', () => {
    expect(knownNumbers(rows, '2', 1, 1, 10).map((r) => r.num)).toEqual([2, 20, 22, 28, 200]);
    expect(knownNumbers(rows, '22', 1, 1, 10).map((r) => r.num)).toEqual([22]);
    expect(knownNumbers(rows, '2', 1, 1, 2).map((r) => r.num)).toEqual([2, 20]);
    expect(knownNumbers([row(9, 2), row(8, 2)], '2', 1, 1, 5).map((r) => r.id)).toEqual([8, 9]);
    expect(knownNumbers(rows, '9', 1, 1, 5)).toEqual([]);
  });
});

describe('completionOf', () => {
  it('gives the text to keep typing for every kind of suggestion', () => {
    expect(completionOf(place({ precision: 'poi', components: { poiName: 'Kipa' } }))).toBe('Kipa ');
    expect(completionOf(place({ precision: 'address', components: { street: 'Gül Sokak', houseNumber: '5' } }))).toBe('Gül Sokak No:5 ');
    expect(completionOf(place({ precision: 'interpolated', components: { street: 'Gül Sokak' } }))).toBe('Gül Sokak ');
    expect(completionOf(place({ precision: 'street', components: { street: 'Gül Sokak' } }))).toBe('Gül Sokak ');
    expect(completionOf(place({ precision: 'neighbourhood', components: { neighbourhood: 'Moda' } }))).toBe('Moda Mah. ');
    expect(completionOf(place({ precision: 'district', components: { district: 'Kadıköy' } }))).toBe('Kadıköy ');
    expect(completionOf(place({ precision: 'province', components: { province: 'İstanbul' } }))).toBe('İstanbul ');
    expect(completionOf(place({ precision: 'poi', components: {} }))).toBeNull();
    expect(completionOf(place({ precision: 'street', components: {} }))).toBeNull();
  });
});

describe('unitHintFor', () => {
  const b = (id: number, over: Partial<BuildingInfo> = {}): BuildingInfo => ({ id, gid: `g${id}`, center: [29, 41], areaM2: 240, levels: 5, levelsSource: 'osm', heightM: null, name: null, chain: 1, part: 0, side: 'left', distanceM: 5, along: 1, sequence: 1, secondChain: null, thirdChain: null, ring: [], ...over });
  const reader = (base: BuildingInfo | null, around: BuildingInfo[]): Buildings2 => ({ at: async () => base, near: async () => around.map((building) => ({ building, distanceM: 10 })) }) as unknown as Buildings2;

  it('lists the block letters around, the floors of the building and a flat count from its size', async () => {
    const hint = await unitHintFor(reader(b(1, { name: 'B Blok' }), [b(2, { name: 'A Blok' }), b(3, { name: 'Plaza' }), b(4, { name: 'Güneş Sitesi C Block' }), b(5, { name: 'Blok' }), b(6)]), [29, 41]);
    expect(hint).toEqual({ blocks: ['A', 'B', 'Güneş Sitesi C'], floors: 5, flats: 10, floorsSource: 'osm' });
  });

  it('has nothing for a point that is not in a building', async () => {
    expect(await unitHintFor(reader(null, []), [29, 41])).toBeNull();
  });
});

describe('recentsAsPlaces', () => {
  const list = [place({ id: 'a', label: 'Evim, Bahariye Caddesi No:9' }), place({ id: 'b', label: 'İş, Gül Sokak No:1' }), place({ id: 'a', label: 'Evim, Bahariye Caddesi No:9' })];

  it('returns the places whose words start with the text, once each, up to the limit', () => {
    expect(recentsAsPlaces(list, 'bahariye', 5, 'tr').map((p) => p.id)).toEqual(['a']);
    expect(recentsAsPlaces(list, 'gul s', 5, 'tr').map((p) => p.id)).toEqual(['b']);
    expect(recentsAsPlaces(list, '', 5, 'tr').map((p) => p.id)).toEqual(['a', 'b']);
    expect(recentsAsPlaces(list, '', 1, 'tr').map((p) => p.id)).toEqual(['a']);
    expect(recentsAsPlaces(list, 'zzz', 5, 'tr')).toEqual([]);
  });
});
