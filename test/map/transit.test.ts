import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { TRANSIT_LINES_FROM, TRANSIT_STATIONS_FROM, buildStyle, type StyleInput, type StyleLayer } from '../../src/native/map/style';

const input = (extra: Partial<StyleInput> = {}): StyleInput => ({
  rootUrl: 'file:///root',
  baseDir: 'base-1',
  regions: [{ id: '34', tilesPath: 'tiles.pmtiles', transitPath: 'transit.pmtiles' }, { id: '35', tilesPath: 'tiles-b.pmtiles' }],
  theme: 'light',
  lang: 'tr',
  ...extra,
});
const find = (layers: StyleLayer[], id: string) => layers.find((l) => l.id === id);

describe('transit layers', () => {
  it('appear only for the provinces that carry a transit part', () => {
    const style = buildStyle(input());
    expect(style.sources.tr34).toMatchObject({ type: 'vector', url: expect.stringContaining('transit.pmtiles') });
    expect(style.sources.tr35).toBeUndefined();
    expect(style.layers.filter((l) => l.id.startsWith('transit-')).every((l) => l.id.endsWith('@tr34'))).toBe(true);
    expect(buildStyle(input({ regions: [{ id: '34', tilesPath: 'tiles.pmtiles' }] })).layers.some((l) => l.id.startsWith('transit-'))).toBe(false);
  });

  it('draws the lines from zoom 11, the stations from 13 and their names from 14', () => {
    const { layers } = buildStyle(input());
    for (const id of ['transit-casing@tr34', 'transit-lines@tr34', 'transit-ferry@tr34']) expect(find(layers, id)?.minzoom).toBe(TRANSIT_LINES_FROM);
    expect(find(layers, 'transit-stations@tr34')?.minzoom).toBe(TRANSIT_STATIONS_FROM);
    expect(find(layers, 'transit-names@tr34')?.minzoom).toBe(TRANSIT_STATIONS_FROM + 1);
  });

  it('uses the colour of the line and the colour of its mode when it has none', () => {
    const paint = find(buildStyle(input()).layers, 'transit-lines@tr34')?.paint as Record<string, unknown[]>;
    expect(paint['line-color']![0]).toBe('coalesce');
    expect(paint['line-color']![1]).toEqual(['get', 'colour']);
    expect(JSON.stringify(paint['line-color'])).toContain('"subway","#D32F2F"');
  });

  it('draws ferries dashed and everything else solid', () => {
    const { layers } = buildStyle(input());
    expect((find(layers, 'transit-ferry@tr34')?.paint as Record<string, unknown>)['line-dasharray']).toEqual([2, 2]);
    expect((find(layers, 'transit-lines@tr34')?.paint as Record<string, unknown>)['line-dasharray']).toBeUndefined();
    expect(JSON.stringify(find(layers, 'transit-lines@tr34')?.filter)).toContain('"!="');
  });

  it('sits above the roads and the dark map has its own casing', () => {
    const ids = buildStyle(input()).layers.map((l) => l.id);
    expect(ids.indexOf('transit-lines@tr34')).toBeGreaterThan(ids.indexOf('roads_highway@r34'));
    const dark = find(buildStyle(input({ theme: 'dark' })).layers, 'transit-casing@tr34')?.paint as Record<string, unknown>;
    expect(dark['line-color']).toBe('#1A1A1D');
  });

  it.each(['light', 'dark'] as const)('is a valid style in the %s theme', (theme) => {
    expect(validateStyleMin(buildStyle(input({ theme })) as never).map((e) => e.message)).toEqual([]);
  });
});
