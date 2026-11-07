import { drawnAt, keepsKey, sourceKind, styleLanguages, styleVariants, TOP_ZOOM, usageProfile, type DrawFeature } from '../../pipeline/build/tile-usage';
import type { MapStyle, StyleLayer } from '../../src/native/map/style';

const style = (layers: StyleLayer[]): MapStyle => ({
  version: 8,
  sources: { base: { type: 'vector', maxzoom: 8 }, r16: { type: 'vector', maxzoom: 15 }, ov16: { type: 'vector', maxzoom: 16 }, hoods: { type: 'geojson' } },
  layers,
});
const point = (properties: DrawFeature['properties']): DrawFeature => ({ type: 1, properties });

describe('sourceKind', () => {
  it('tells the pack a style source reads from its name', () => {
    expect(['base', 'r16', 'r06', 'ov34', 'tr34', 'hoods', 'rx'].map(sourceKind)).toEqual(['overview', 'tiles', 'tiles', 'places', null, null, null]);
  });
});

describe('usageProfile', () => {
  it('collects the properties a layer reads in any way', () => {
    const profile = usageProfile([
      style([
        { id: 'a', type: 'symbol', source: 'r16', 'source-layer': 'pois', filter: ['all', ['==', 'kind', 'cafe'], ['has', 'name'], ['==', '$type', 'Point']], layout: { 'text-field': '{name:tr} {ref}' }, paint: { 'text-color': ['match', ['get', 'colour'], 'red', '#f00', '#000'] } },
        { id: 'b', type: 'line', source: 'r16', 'source-layer': 'roads', filter: ['in', ['get', 'kind'], ['literal', ['highway']]], layout: { visibility: 'none' }, paint: { 'line-width': ['coalesce', ['get', 'width'], 1] } },
        { id: 'c', type: 'circle', source: 'hoods', paint: { 'circle-radius': ['get', 'size'] } },
      ]),
    ]);
    expect([...(profile.props.get('tiles/pois') as Set<string>)].sort()).toEqual(['colour', 'kind', 'name', 'name:tr', 'ref']);
    expect([...(profile.props.get('tiles/roads') as Set<string>)].sort()).toEqual(['kind', 'width']);
    expect(profile.props.has('tiles/hoods')).toBe(false);
    expect([...profile.labels].sort()).toEqual(['name:tr', 'ref']);
    expect(profile.named.has('tiles/pois')).toBe(true);
    expect(profile.rules.get('tiles/pois')).toHaveLength(1);
    expect(profile.rules.has('tiles/roads')).toBe(false);
    expect(profile.maxzoom).toEqual({ overview: 8, tiles: 15, places: 16 });
  });

  it('keeps the literal strings of text fields for the font check', () => {
    const profile = usageProfile([style([{ id: 'a', type: 'symbol', source: 'ov16', 'source-layer': 'places', layout: { 'text-field': ['match', ['get', 'b'], 'migros', 'M', 'şok', 'Ş', ''] } }])]);
    expect(profile.literals.has('Ş')).toBe(true);
    expect(profile.named.has('places/places')).toBe(false);
  });

  it('refuses styles that pick property names at run time', () => {
    expect(() => usageProfile([style([{ id: 'x', type: 'fill', source: 'r16', 'source-layer': 'water', paint: { 'fill-color': ['get', ['concat', 'c', 'olour']] } }])])).toThrow(/ifadeyle/);
    expect(() => usageProfile([style([{ id: 'x', type: 'fill', source: 'r16', 'source-layer': 'water', paint: { 'fill-color': ['get', 'c', ['properties']] } }])])).toThrow(/bütün özellikler/);
  });

  it('gives the same digest for the same rules and a new one when a rule changes', () => {
    const layer = (minzoom: number): StyleLayer => ({ id: 'a', type: 'fill', source: 'r16', 'source-layer': 'water', minzoom, filter: ['==', ['get', 'kind'], 'lake'] });
    expect(usageProfile([style([layer(5)])]).digest).toBe(usageProfile([style([layer(5)]), style([layer(5)])]).digest);
    expect(usageProfile([style([layer(5)])]).digest).not.toBe(usageProfile([style([layer(6)])]).digest);
  });
});

describe('feature ids', () => {
  const idStyle = (filter: unknown[]) => style([{ id: 'a', type: 'fill', source: 'r16', 'source-layer': 'water', filter } as StyleLayer]);

  it('are noticed when a layer reads them', () => {
    expect(usageProfile([idStyle(['==', ['id'], 5])]).usesIds).toBe(true);
    expect(usageProfile([idStyle(['==', '$id', 5])]).usesIds).toBe(true);
    expect(usageProfile([idStyle(['==', ['get', 'kind'], 'lake'])]).usesIds).toBe(false);
  });

  it('are not read by any SDK style', () => {
    expect(usageProfile(styleVariants(['tr', 'xx'])).usesIds).toBe(false);
  });
});

describe('keepsKey', () => {
  const profile = usageProfile([
    style([
      { id: 'n', type: 'symbol', source: 'r16', 'source-layer': 'places', layout: { 'text-field': ['coalesce', ['get', 'name:tr'], ['get', 'name']] } },
      { id: 'w', type: 'fill', source: 'r16', 'source-layer': 'water', filter: ['==', ['get', 'kind'], 'lake'] },
    ]),
  ]);

  it('keeps names in every two letter language on labelled layers', () => {
    const keep = keepsKey(profile, 'tiles', 'places') as (key: string) => boolean;
    expect(['name', 'name:tr', 'name:de', 'name:ka'].map(keep)).toEqual([true, true, true, true]);
    expect(['name:zh-Hans', 'pgf:name:hi', 'wikidata', 'sort_rank'].map(keep)).toEqual([false, false, false, false]);
  });

  it('keeps what the place card reads on every layer but no other names', () => {
    const keep = keepsKey(profile, 'tiles', 'water') as (key: string) => boolean;
    expect(['kind', 'name', 'name:tr', 'grp', 'g'].map(keep)).toEqual([true, true, true, true, true]);
    expect(['name:de', 'min_zoom'].map(keep)).toEqual([false, false]);
  });

  it('keeps the landmark flag the legend toggle filters on', () => {
    const keep = keepsKey(profile, 'tiles', 'places') as (key: string) => boolean;
    expect(keep('lm')).toBe(true);
  });

  it('has nothing to keep for a layer no style reads', () => {
    expect(keepsKey(profile, 'tiles', 'landcover')).toBeNull();
    expect(keepsKey(profile, 'places', 'places')).toBeNull();
  });
});

describe('drawnAt', () => {
  const profileOf = (layer: Partial<StyleLayer>) => usageProfile([style([{ id: 'l', type: 'fill', source: 'r16', 'source-layer': 'water', ...layer } as StyleLayer])]);

  it('tests a tile at its own whole zoom level, the way the map does', () => {
    const profile = profileOf({ minzoom: 14.5, filter: ['<', ['zoom'], 14.5] });
    expect(drawnAt(profile, 'tiles', 'water', 14, 15)(point({}))).toBe(true);
    expect(drawnAt(profile, 'tiles', 'water', 13, 15)(point({}))).toBe(false);
  });

  it('counts the max zoom of a layer as drawn', () => {
    const profile = profileOf({ maxzoom: 9 });
    expect(drawnAt(profile, 'tiles', 'water', 9, 15)(point({}))).toBe(true);
    expect(drawnAt(profile, 'tiles', 'water', 10, 15)(point({}))).toBe(false);
  });

  it('tests the deepest tiles at every zoom they are stretched to', () => {
    const profile = profileOf({ filter: ['>=', ['zoom'], ['get', 'min_zoom']] });
    expect(drawnAt(profile, 'tiles', 'water', 15, 15)(point({ min_zoom: 18 }))).toBe(true);
    expect(drawnAt(profile, 'tiles', 'water', 15, 15)(point({ min_zoom: TOP_ZOOM + 1 }))).toBe(false);
    expect(drawnAt(profile, 'tiles', 'water', 14, 15)(point({ min_zoom: 15 }))).toBe(false);
    expect(drawnAt(profile, 'tiles', 'water', 14, 15)(point({ min_zoom: 14 }))).toBe(true);
  });

  it('follows the filter of each layer on the source layer', () => {
    const profile = usageProfile([
      style([
        { id: 'a', type: 'fill', source: 'r16', 'source-layer': 'landuse', filter: ['==', ['get', 'kind'], 'park'] },
        { id: 'b', type: 'fill', source: 'r16', 'source-layer': 'landuse', minzoom: 12, filter: ['==', ['get', 'kind'], 'school'] },
      ]),
    ]);
    const at = (zoom: number, kind: string): boolean => drawnAt(profile, 'tiles', 'landuse', zoom, 15)(point({ kind }));
    expect([at(5, 'park'), at(5, 'school'), at(12, 'school'), at(12, 'farm')]).toEqual([true, false, true, false]);
  });

  it('keeps everything when a filter needs the geometry', () => {
    const profile = profileOf({ filter: ['within', { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }] });
    expect(drawnAt(profile, 'tiles', 'water', 3, 15)(point({}))).toBe(true);
  });

  it('draws nothing for a layer without rules', () => {
    expect(drawnAt(profileOf({}), 'tiles', 'roads', 10, 15)(point({ kind: 'x' }))).toBe(false);
  });
});

describe('the SDK styles', () => {
  it('cover every two letter language the label code knows and an unknown one', () => {
    const langs = styleLanguages();
    expect(langs).toEqual(expect.arrayContaining(['tr', 'en', 'de', 'ar', 'ru', 'el', 'zh', 'xx']));
    expect(langs.every((lang) => /^[a-z]{2}$/.test(lang))).toBe(true);
  });

  it('give a profile with the layers the map draws', () => {
    const profile = usageProfile(styleVariants(['tr', 'xx']));
    expect(profile.maxzoom).toEqual({ overview: 8, tiles: 15, places: 16 });
    expect([...(profile.props.get('tiles/pois') as Set<string>)]).toEqual(expect.arrayContaining(['kind', 'min_zoom']));
    expect([...(profile.props.get('places/places') as Set<string>)]).toEqual(expect.arrayContaining(['b', 'c', 'g']));
    expect([...(profile.props.get('tiles/buildings') as Set<string>)]).toEqual(expect.arrayContaining(['height', 'min_height']));
    expect(profile.props.has('overview/places')).toBe(true);
    expect(profile.named.has('tiles/roads')).toBe(true);
  });
});
