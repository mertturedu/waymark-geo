import { BASE_KEYS, DARK_BASE } from '../../src/native/map/base-colors';
import { BUILDINGS_3D_FROM, buildStyle, type StyleInput, type StyleLayer } from '../../src/native/map/style';
import { contrast, createGeoTheme, DEFAULT_THEME, ICON_GROUPS, inkColor, parseColor, resolveMapLook } from '../../src/native/map/theme';

const regions = [{ id: '34', tilesPath: 'tiles-a.pmtiles', placesPath: 'places-a.pmtiles' }, { id: '35', tilesPath: 'tiles-b.pmtiles' }];
const input = (extra: Partial<StyleInput> = {}): StyleInput => ({ rootUrl: 'file:///root', baseDir: 'base-1', regions, theme: 'light', lang: 'tr', ...extra });
const find = (style: { layers: StyleLayer[] }, id: string) => style.layers.find((l) => l.id === id);

describe('3D buildings', () => {
  it('adds one extrusion layer for each province source, from zoom 16', () => {
    const style = buildStyle(input());
    for (const id of ['buildings3d@r34', 'buildings3d@r35']) {
      expect(find(style, id)).toMatchObject({ type: 'fill-extrusion', minzoom: BUILDINGS_3D_FROM, 'source-layer': 'buildings', filter: ['in', 'kind', 'building', 'building_part'] });
    }
    expect(find(style, 'buildings3d@base')).toBeUndefined();
  });

  it('is off when the theme turns it off and on by default', () => {
    expect(DEFAULT_THEME.light.map.buildings3d).toBe(true);
    const off = resolveMapLook(DEFAULT_THEME.light.map, { buildings3d: false });
    expect(buildStyle(input({ look: off })).layers.some((l) => l.type === 'fill-extrusion')).toBe(false);
    expect(resolveMapLook(off, {}).buildings3d).toBe(false);
    expect(resolveMapLook(off, { buildings3d: true }).buildings3d).toBe(true);
    expect(createGeoTheme({ map: { buildings3d: false } }).light.map.buildings3d).toBe(false);
  });

  it('rises from nothing at zoom 16 to the building height, and uses the height, then 6 m', () => {
    const paint = find(buildStyle(input()), 'buildings3d@r34')?.paint as Record<string, unknown[]>;
    const height = paint['fill-extrusion-height']!;
    expect(height.slice(0, 5)).toEqual(['interpolate', ['linear'], ['zoom'], 16, 0]);
    expect(height[5]).toBeCloseTo(16.6);
    expect(height[6]).toEqual(['coalesce', ['get', 'height'], 6]);
    expect(paint['fill-extrusion-base']![6]).toEqual(['coalesce', ['get', 'min_height'], 0]);
    expect(paint['fill-extrusion-opacity']).toBe(0.85);
  });

  it('follows the base colour of the theme', () => {
    const style = buildStyle(input({ look: resolveMapLook(DEFAULT_THEME.light.map, { base: { buildings: '#FF0000' } }) }));
    expect((find(style, 'buildings3d@r34')?.paint as Record<string, unknown>)['fill-extrusion-color']).toBe('#FF0000');
  });

  it('keeps the flat building layer below it', () => {
    const ids = buildStyle(input()).layers.map((l) => l.id);
    expect(ids.indexOf('buildings@r34')).toBeLessThan(ids.indexOf('buildings3d@r34'));
  });
});

describe('dark base map', () => {
  it('holds only known keys with valid colours', () => {
    for (const [key, value] of Object.entries(DARK_BASE)) {
      expect(BASE_KEYS).toContain(key);
      expect(parseColor(value)).not.toBeNull();
    }
    expect(Object.keys(DARK_BASE).length).toBeGreaterThan(60);
  });

  it('is darker than the light map where it matters', () => {
    const light = DEFAULT_THEME.light.map.base;
    for (const key of ['background', 'earth', 'water', 'buildings']) expect(DARK_BASE[key]).not.toBe(light[key]);
    expect(contrast(DARK_BASE.highway!, DARK_BASE.earth!)).toBeGreaterThan(1.3);
    expect(contrast(DARK_BASE.water!, DARK_BASE.earth!)).toBeGreaterThan(1.0);
  });

  it('keeps street, neighbourhood and place names readable against the ground (4.5:1)', () => {
    for (const key of ['roads_label_minor', 'roads_label_major', 'subplace_label', 'city_label', 'address_label']) expect(contrast(DARK_BASE[key]!, DARK_BASE.earth!)).toBeGreaterThanOrEqual(4.5);
    for (const key of ['roads_label_minor_halo', 'subplace_label_halo']) expect(DARK_BASE[key]).toBe(DARK_BASE.earth);
  });

  it('keeps every group name readable on the dark ground', () => {
    const dark = DEFAULT_THEME.dark;
    for (const group of ICON_GROUPS) expect(contrast(inkColor(dark.map, group, 'dark', dark.colors.accent), DARK_BASE.earth!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('terrain tones', () => {
  const park = (theme: 'light' | 'dark') => {
    const style = buildStyle(input({ theme, look: theme === 'dark' ? DEFAULT_THEME.dark.map : DEFAULT_THEME.light.map }));
    return find(style, 'landuse_park@r34') as StyleLayer;
  };

  it('gives cemeteries and sports grounds their own colour without adding layers', () => {
    const light = JSON.stringify(park('light').paint);
    expect(light).toContain('#D6E3CC');
    expect(light).toContain('#C4E6B8');
    const filter = park('light').filter as string[];
    for (const kind of ['cemetery', 'pitch', 'stadium', 'track', 'sports_centre']) expect(filter).toContain(kind);
  });

  it('has darker versions on the dark map', () => {
    const dark = JSON.stringify(park('dark').paint);
    expect(dark).toContain('#27342B');
    expect(dark).not.toContain('#D6E3CC');
  });

  it('can be changed from the theme', () => {
    const look = resolveMapLook(DEFAULT_THEME.light.map, { base: { cemetery: '#112233' } });
    expect(JSON.stringify(find(buildStyle(input({ look })), 'landuse_park@r34')?.paint)).toContain('#112233');
  });
});
