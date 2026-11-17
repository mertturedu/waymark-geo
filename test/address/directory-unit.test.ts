import { DIRECTORY_FACTOR, mergeDirectory } from '../../src/core/address/directory';
import type { Scored } from '../../src/core/address/resolve';
import type { Place } from '../../src/core/address/types';

type Make = { id: string; precision: Place['precision']; source?: Place['source']; street?: string; number?: string; poi?: string; district?: string; at?: [number, number]; score?: number; approximate?: boolean };

const item = (m: Make): Scored => ({
  score: m.score ?? 0.9,
  area: '1/1',
  place: {
    id: m.id,
    label: m.id,
    components: { district: m.district ?? 'Kadıköy', street: m.street, houseNumber: m.number, poiName: m.poi },
    coordinate: m.at ?? [29, 41],
    precision: m.precision,
    approximate: m.approximate ?? false,
    source: m.source ?? 'osm',
    confidence: m.score ?? 0.9,
    region: '34',
  },
});

const ids = (list: Scored[]): string[] => list.map((s) => s.place.id);

describe('mergeDirectory', () => {
  it('keeps every address pack result untouched and first', () => {
    const own = [item({ id: '34:a:1', precision: 'address', street: 'Gül Sokak', number: '3' })];
    const merged = mergeDirectory('34', own, []);
    expect(merged).toEqual(own);
  });

  it('turns a listed door into an approximate guess from the directory', () => {
    const merged = mergeDirectory('34', [], [item({ id: '34:a:7', precision: 'address', street: 'Gül Sokak', number: '5', score: 0.9 })]);
    expect(merged[0]?.place).toMatchObject({ id: '34+:a:7', precision: 'interpolated', approximate: true, source: 'overture' });
    expect(merged[0]?.score).toBeCloseTo(0.9 * DIRECTORY_FACTOR, 6);
    expect(merged[0]?.place.confidence).toBeCloseTo(0.9 * DIRECTORY_FACTOR, 3);
  });

  it('drops a listed door the address pack already has, ignoring spelling of street and number', () => {
    const own = [item({ id: '34:a:1', precision: 'address', street: 'Gül Sokağı', number: '3/A' })];
    const extra = [item({ id: '34:a:9', precision: 'address', street: 'GÜL SOKAK', number: '3/a' })];
    expect(ids(mergeDirectory('34', own, extra))).toEqual(['34:a:1']);
  });

  it('keeps a listed door of the same street in another district', () => {
    const own = [item({ id: '34:a:1', precision: 'address', street: 'Gül Sokak', number: '3' })];
    const extra = [item({ id: '34:a:9', precision: 'address', street: 'Gül Sokak', number: '3', district: 'Üsküdar' })];
    expect(ids(mergeDirectory('34', own, extra))).toEqual(['34:a:1', '34+:a:9']);
  });

  it('prefers a listed door over a guess of the address pack', () => {
    const own = [item({ id: '34:g:1', precision: 'interpolated', source: 'interpolated', street: 'Gül Sokak', number: '5', approximate: true })];
    const extra = [item({ id: '34:a:9', precision: 'address', street: 'Gül Sokak', number: '5' })];
    expect(ids(mergeDirectory('34', own, extra))).toEqual(['34:g:1', '34+:a:9']);
  });

  it('drops a directory guess when the address pack guessed the same number', () => {
    const own = [item({ id: '34:g:1', precision: 'interpolated', source: 'interpolated', street: 'Gül Sokak', number: '5', approximate: true })];
    const extra = [item({ id: '34:g:2', precision: 'interpolated', source: 'interpolated', street: 'Gül Sokak', number: '5', approximate: true })];
    expect(ids(mergeDirectory('34', own, extra))).toEqual(['34:g:1']);
  });

  it('keeps a directory guess when the address pack has no such number', () => {
    const own = [item({ id: '34:a:1', precision: 'address', street: 'Gül Sokak', number: '3' })];
    const extra = [item({ id: '34:g:2', precision: 'interpolated', source: 'interpolated', street: 'Gül Sokak', number: '5', approximate: true })];
    expect(ids(mergeDirectory('34', own, extra))).toEqual(['34:a:1', '34+:g:2']);
  });

  it('drops a directory street the address pack knows and keeps one it does not', () => {
    const own = [item({ id: '34:s:1', precision: 'street', source: 'derived', street: 'Gül Sokak', approximate: true })];
    const extra = [
      item({ id: '34:s:5', precision: 'street', source: 'derived', street: 'Gül Sokak', approximate: true }),
      item({ id: '34:s:6', precision: 'street', source: 'derived', street: 'Yeni Sokak', approximate: true }),
    ];
    expect(ids(mergeDirectory('34', own, extra))).toEqual(['34:s:1', '34+:s:6']);
  });

  it('never takes neighbourhood or district results from the directory', () => {
    const extra = [item({ id: '34:h:1', precision: 'neighbourhood', source: 'derived' }), item({ id: '34:d:1', precision: 'district', source: 'derived' })];
    expect(mergeDirectory('34', [], extra)).toEqual([]);
  });

  it('drops a business the address pack lists under the same name nearby and keeps it when far away', () => {
    const own = [item({ id: '34:o:1', precision: 'poi', poi: 'Merkez Eczanesi', at: [29, 41] })];
    const near = item({ id: '34:o:2', precision: 'poi', poi: 'merkez eczanesi', at: [29.0005, 41] });
    const far = item({ id: '34:o:3', precision: 'poi', poi: 'Merkez Eczanesi', at: [29.1, 41] });
    expect(ids(mergeDirectory('34', own, [near, far]))).toEqual(['34:o:1', '34+:o:3']);
    expect(mergeDirectory('34', own, [far])[1]?.place.source).toBe('overture');
  });

  it('leaves an id that does not start with the province alone', () => {
    const merged = mergeDirectory('34', [], [item({ id: 'x:o:3', precision: 'poi', poi: 'Köşe Market' })]);
    expect(merged[0]?.place.id).toBe('x:o:3');
  });

  it('keeps other sources such as street guesses as they are', () => {
    const merged = mergeDirectory('34', [], [item({ id: '34:s:6', precision: 'street', source: 'derived', street: 'Yeni Sokak', approximate: true })]);
    expect(merged[0]?.place).toMatchObject({ source: 'derived', precision: 'street', approximate: true });
  });

  it('copes with results that lack street, number, district or name', () => {
    const bare = (id: string, precision: Place['precision']): Scored => ({ ...item({ id, precision }), place: { ...item({ id, precision }).place, components: {} } });
    const own = [bare('34:a:1', 'address'), bare('34:o:1', 'poi')];
    const merged = mergeDirectory('34', own, [bare('34:a:2', 'address'), bare('34:o:2', 'poi'), bare('34:s:2', 'street')]);
    expect(ids(merged)).toEqual(['34:a:1', '34:o:1']);
  });
});

describe('mergeDirectory knows streets by neighbourhood and kind', () => {
  const make = (id: string, extra: Partial<Parameters<typeof item>[0]> & { hood?: string }): Scored => {
    const base = item({ id, precision: 'address', street: 'Gül Sokak', number: '5', ...extra });
    return extra.hood ? { ...base, place: { ...base.place, components: { ...base.place.components, neighbourhood: extra.hood } } } : base;
  };

  it('keeps a listed door in another neighbourhood far away', () => {
    const own = [make('34:a:1', { hood: 'Moda', at: [29, 41] })];
    const extra = [make('34:a:2', { hood: 'Fener', at: [29.05, 41] })];
    expect(ids(mergeDirectory('34', own, extra))).toEqual(['34:a:1', '34+:a:2']);
  });

  it('drops a listed door whose neighbourhood differs but which lies at the same spot', () => {
    const own = [make('34:a:1', { hood: 'Moda', at: [29, 41] })];
    const extra = [make('34:a:2', { hood: 'Fener', at: [29.0004, 41] })];
    expect(ids(mergeDirectory('34', own, extra))).toEqual(['34:a:1']);
  });

  it('drops a listed door when one side names no neighbourhood', () => {
    const own = [make('34:a:1', { hood: 'Moda', at: [29, 41] })];
    expect(ids(mergeDirectory('34', own, [make('34:a:2', { at: [29.05, 41] })]))).toEqual(['34:a:1']);
  });

  it('keeps a street of the same name but another kind', () => {
    const own = [make('34:a:1', { street: 'Gül Sokak' })];
    const extra = [make('34:a:2', { street: 'Gül Caddesi' })];
    expect(ids(mergeDirectory('34', own, extra))).toEqual(['34:a:1', '34+:a:2']);
    const numbered = [make('34:a:1', { street: '1707. Sokak' })];
    expect(ids(mergeDirectory('34', numbered, [make('34:a:2', { street: '1707. Cadde' })]))).toEqual(['34:a:1', '34+:a:2']);
  });

  it('treats a street without a kind as the same street', () => {
    const own = [make('34:a:1', { street: 'Gül Sokak' })];
    expect(ids(mergeDirectory('34', own, [make('34:a:2', { street: 'Gül' })]))).toEqual(['34:a:1']);
  });

  it('keeps a directory street of another neighbourhood', () => {
    const own = [make('34:s:1', { precision: 'street', source: 'derived', hood: 'Moda' })];
    const extra = [make('34:s:2', { precision: 'street', source: 'derived', hood: 'Fener' })];
    expect(ids(mergeDirectory('34', own, extra))).toEqual(['34:s:1', '34+:s:2']);
  });

  it('lists a building name once when the directory has it twice nearby', () => {
    const twice = [
      item({ id: '34:p:1', precision: 'poi', poi: 'Başakkent Sitesi', at: [29, 41], score: 0.9 }),
      item({ id: '34:p:2', precision: 'poi', poi: 'BAŞAKKENT SİTESİ', at: [29.0004, 41], score: 0.85 }),
      item({ id: '34:p:3', precision: 'poi', poi: 'Başakkent Sitesi', at: [29.1, 41], score: 0.8 }),
      item({ id: '34:p:4', precision: 'poi', poi: 'Ateş Apartmanı', at: [29, 41], score: 0.8 }),
    ];
    expect(ids(mergeDirectory('34', [], twice))).toEqual(['34+:p:1', '34+:p:3', '34+:p:4']);
  });
});
