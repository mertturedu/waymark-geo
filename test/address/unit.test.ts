import type { BuildingInfo, EntranceInfo } from '../../src/core/address/buildings2';
import { doorNumber, estimateFloor, floorNumber, formatUnit, isRoofFloor, pickEntrance, resolveBlock, resolveUnit, unitsPerFloor, type UnitInfo } from '../../src/core/address/unit';

const building = (id: number, over: Partial<BuildingInfo> = {}): BuildingInfo => ({ id, gid: `g${id}`, center: [29 + id * 0.0003, 41], areaM2: 480, levels: 5, levelsSource: 'num_floors', heightM: null, name: null, chain: 1, part: 0, side: 'left', distanceM: 10, along: id * 10, sequence: id, secondChain: null, thirdChain: null, ring: [], ...over });
const entrance = (id: number, over: Partial<EntranceInfo> = {}): EntranceInfo => ({ id, building: 1, point: [29, 41], kind: 'main', ref: null, flats: null, unit: null, ...over });
const none = (): EntranceInfo[] => [];

describe('floorNumber and doorNumber', () => {
  it('reads digits, ground and basement words and ignores the rest', () => {
    expect(floorNumber('3')).toBe(3);
    expect(floorNumber('Zemin')).toBe(0);
    expect(floorNumber('bodrum')).toBe(-1);
    expect(floorNumber('-2')).toBe(-2);
    expect(floorNumber('çatı')).toBeNull();
    expect(floorNumber(null)).toBeNull();
    expect(doorNumber('D:15')).toBe(15);
    expect(doorNumber('a')).toBeNull();
    expect(doorNumber(null)).toBeNull();
  });
});

describe('estimateFloor', () => {
  it('counts flats per floor from the footprint and starts at the ground floor', () => {
    expect(unitsPerFloor(480)).toBe(4);
    expect(unitsPerFloor(40)).toBe(1);
    expect(unitsPerFloor(5000)).toBe(8);
    expect(estimateFloor(7, 4)).toMatchObject({ value: 1, source: 'model' });
    expect(estimateFloor(1, 4).value).toBe(0);
  });

  it('shifts the floors down by the basement count and gives a range', () => {
    const f = estimateFloor(9, 4, 1);
    expect(f.value).toBe(1);
    expect(f.low).toBeLessThanOrEqual(f.value);
    expect(f.high).toBeGreaterThanOrEqual(f.value);
    expect(f.high).toBeGreaterThan(f.low);
  });
});

describe('resolveBlock', () => {
  const base = building(1, { name: 'A Blok' });
  const around = [building(2, { name: 'B Blok' }), building(3, { name: 'C Blok' }), building(4, { name: 'Plaza' }), building(5, { name: 'B Blok', center: [29.5, 41] })];

  it('finds the building named for the block inside the site and ignores far ones', () => {
    expect(resolveBlock('C Blok', base, around)?.id).toBe(3);
    expect(resolveBlock('b', base, around)?.id).toBe(2);
    expect(resolveBlock('Blok A', base, around)?.id).toBe(1);
    expect(resolveBlock('D Blok', base, around)).toBeNull();
    expect(resolveBlock('', base, around)).toBeNull();
  });

  it('matches the block letter at the end of a site-prefixed name', () => {
    const site = [building(6, { name: 'Güneş Sitesi D Blok' })];
    expect(resolveBlock('D', base, site)?.id).toBe(6);
    expect(resolveBlock('Sitesi', base, site)).toBeNull();
  });
});

describe('pickEntrance', () => {
  it('takes the only entrance, matches the flat range, or stays unknown', () => {
    expect(pickEntrance([], 5)).toBeNull();
    expect(pickEntrance([entrance(1)], null)?.id).toBe(1);
    const two = [entrance(1, { ref: 'A', flats: '1-8' }), entrance(2, { ref: 'B', flats: '9-16' })];
    expect(pickEntrance(two, 12)?.ref).toBe('B');
    expect(pickEntrance(two, 40)).toBeNull();
    expect(pickEntrance(two, null)).toBeNull();
    expect(pickEntrance([entrance(1), entrance(2)], 3)).toBeNull();
  });

  it('takes the entrance that was written, whatever the flat, and ignores one the building does not have', () => {
    const two = [entrance(1, { ref: 'A', flats: '1-8' }), entrance(2, { ref: 'B', flats: '9-16' })];
    expect(pickEntrance(two, 3, 'b')?.id).toBe(2);
    expect(pickEntrance(two, null, 'A')?.id).toBe(1);
    expect(pickEntrance(two, 3, 'Z')?.id).toBe(1);
    expect(pickEntrance(two, null, 'Z')).toBeNull();
    expect(pickEntrance([entrance(1, { ref: '2' }), entrance(2, { ref: '2' })], null, '2')).toBeNull();
  });
});

describe('resolveUnit', () => {
  const base = building(1);

  it('keeps the written floor and the written door', () => {
    const unit = resolveUnit({ floor: '3', door: '12', block: null }, base, [], none);
    expect(unit.floor).toEqual({ value: 3, low: 3, high: 3, source: 'written' });
    expect(unit.door).toBe('12');
    expect(unit.notes).toEqual([]);
  });

  it('estimates the floor from the door when none is written', () => {
    const unit = resolveUnit({ floor: null, door: '10', block: null }, base, [], none);
    expect(unit.floor?.source).toBe('model');
    expect(unit.floor?.value).toBe(2);
  });

  it('flags a floor above the building, a door far beyond it, and a floor that does not fit the door', () => {
    expect(resolveUnit({ floor: '9', door: null, block: null }, base, [], none).notes).toContain('floor_out_of_range');
    expect(resolveUnit({ floor: null, door: '90', block: null }, base, [], none).notes).toContain('door_out_of_range');
    expect(resolveUnit({ floor: '0', door: '17', block: null }, base, [], none).notes).toContain('floor_door_mismatch');
    expect(resolveUnit({ floor: '2', door: '10', block: null }, base, [], none).notes).toEqual([]);
  });

  it('is gentler when the number of floors is only a regional guess', () => {
    const guess = building(2, { levelsSource: 'region' });
    expect(resolveUnit({ floor: '7', door: null, block: null }, guess, [], none).notes).toEqual([]);
    expect(resolveUnit({ floor: '12', door: null, block: null }, guess, [], none).notes).toContain('floor_out_of_range');
  });

  it('moves to the named block, or says it is missing', () => {
    const blocks = [building(3, { name: 'C Blok', levels: 8 })];
    const found = resolveUnit({ floor: null, door: null, block: 'C Blok' }, base, blocks, none);
    expect(found.block).toMatchObject({ building: 3 });
    expect(found.levels).toBe(8);
    const missing = resolveUnit({ floor: null, door: null, block: 'Z Blok' }, base, blocks, none);
    expect(missing.block).toEqual({ name: 'Z Blok', building: null, center: null });
    expect(missing.notes).toContain('block_not_found');
  });

  it('picks the entrance by flat range', () => {
    const entrances = (id: number): EntranceInfo[] => (id === 1 ? [entrance(1, { ref: 'A', flats: '1-8' }), entrance(2, { ref: 'B', flats: '9-16' })] : []);
    expect(resolveUnit({ floor: null, door: '12', block: null }, base, [], entrances).entrance?.ref).toBe('B');
  });
});

describe('written entrance, roof floor and deep basement', () => {
  const base = building(1);
  const two = [entrance(1, { ref: '1', flats: '1-8' }), entrance(2, { ref: '2', flats: '9-16' })];

  it('puts the written entrance on the unit', () => {
    expect(resolveUnit({ floor: null, door: '3', block: null, entrance: '2' }, base, [], () => two).entrance?.ref).toBe('2');
    expect(resolveUnit({ floor: null, door: '3', block: null }, base, [], () => two).entrance?.ref).toBe('1');
  });

  it('turns a roof floor into the top floor of the building, with a range', () => {
    const unit = resolveUnit({ floor: 'çatı katı', door: null, block: null }, base, [], none);
    expect(unit.floor).toMatchObject({ value: 4, low: 3, high: 5, source: 'model' });
    expect(resolveUnit({ floor: 'Çatı', door: null, block: null }, building(2, { levels: 1 }), [], none).floor).toMatchObject({ value: 0, low: 0, high: 1 });
    expect(isRoofFloor('çatı')).toBe(true);
    expect(isRoofFloor('3')).toBe(false);
    expect(isRoofFloor(null)).toBe(false);
  });

  it('says how deep a basement floor is in six languages', () => {
    const at = (value: number) => ({ block: null, entrance: null, floor: { value, low: value, high: value, source: 'written' as const }, door: null, levels: 5, perFloor: 4, notes: [] });
    expect(formatUnit(at(-1), 'tr')).toBe('Bodrum Kat');
    expect(formatUnit(at(-2), 'tr')).toBe('2. Bodrum Kat');
    expect(formatUnit(at(-2), 'en')).toBe('Basement 2');
    expect(formatUnit(at(-2), 'de')).toBe('2. Untergeschoss');
    expect(formatUnit(at(-2), 'ar')).toBe('القبو 2');
    expect(formatUnit(at(-2), 'ru')).toBe('подвал 2');
    expect(formatUnit(at(-2), 'el')).toBe('υπόγειο 2');
    expect(formatUnit(at(-1), 'en')).toBe('Basement');
  });
});

describe('formatUnit', () => {
  const unit: UnitInfo = { block: { name: 'C Blok', building: 3, center: [29, 41] }, entrance: entrance(1, { ref: '2' }), floor: { value: 3, low: 2, high: 4, source: 'model' }, door: '7', levels: 5, perFloor: 4, notes: [] };

  it('writes the unit line in all six languages', () => {
    expect(formatUnit(unit, 'tr')).toBe('C Blok, Giriş 2, Kat 3 (tahmini: 2-4), Daire 7');
    expect(formatUnit(unit, 'en')).toBe('Block C, Entrance 2, Floor 3 (est.: 2-4), Apt 7');
    expect(formatUnit(unit, 'de')).toBe('Block C, Eingang 2, 3. Stock (geschätzt: 2-4), Wohnung 7');
    expect(formatUnit(unit, 'ru')).toBe('Корпус C, подъезд 2, этаж 3 (примерно: 2-4), кв. 7');
    expect(formatUnit(unit, 'el')).toBe('Κτίριο C, είσοδος 2, όροφος 3 (εκτίμηση: 2-4), διαμ. 7');
    expect(formatUnit(unit, 'ar')).toContain('المبنى C');
  });

  it('says ground and basement floors and leaves written floors without the estimate mark', () => {
    expect(formatUnit({ ...unit, block: null, entrance: null, door: null, floor: { value: 0, low: 0, high: 0, source: 'written' } }, 'tr')).toBe('Zemin Kat');
    expect(formatUnit({ ...unit, block: null, entrance: null, door: null, floor: { value: -1, low: -1, high: -1, source: 'written' } }, 'en')).toBe('Basement');
    expect(formatUnit({ ...unit, block: null, entrance: null, door: null, floor: { value: 4, low: 4, high: 4, source: 'model' } }, 'tr')).toBe('Kat 4 (tahmini)');
    expect(formatUnit({ ...unit, block: null, entrance: null, floor: null, door: null }, 'tr')).toBe('');
  });
});
