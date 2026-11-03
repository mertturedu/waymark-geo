import { expression, featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps';
import { DEFAULT_THEME, resolveMapLook } from '../../src/native/map/theme';
import chains from '../../src/native/map/chains.json';
import { SEMI_TRANSPARENT_FROM_ZOOM, buildStyle, semiTransparentLayerIds, type StyleInput, type StyleLayer } from '../../src/native/map/style';

const ROOT = 'file:///var/mobile/Containers/Data/Application/ABC-123/Documents/yuksi-geo/';
const input = (extra: Partial<StyleInput> = {}): StyleInput => ({
  rootUrl: ROOT,
  baseDir: 'files/base-20261022',
  regions: [{ id: '34', tilesPath: 'files/34/tiles-0a0b0c0d.pmtiles' }],
  theme: 'light',
  lang: 'tr',
  ...extra,
});

const FLAVOR_LAYERS = (theme: 'light' | 'dark', lang = 'tr') => protomapsLayers('protomaps', namedFlavor(theme), { lang }) as unknown as { id: string; type: string; source?: string; paint?: Record<string, unknown>; minzoom?: number; maxzoom?: number }[];

describe('buildStyle', () => {
  it('draws only a background when no base pack is installed', () => {
    const style = buildStyle(input({ baseDir: null, regions: [] }));
    expect(style.sources).toEqual({});
    expect(style.layers.map((l) => l.type)).toEqual(['background']);
    expect(style.glyphs).toBeUndefined();
    expect(style.sprite).toBeUndefined();
    expect(style.version).toBe(8);
  });

  it('draws the base pack alone before any province is installed', () => {
    const style = buildStyle(input({ regions: [] }));
    expect(Object.keys(style.sources)).toEqual(['base']);
    expect(style.layers.length).toBe(FLAVOR_LAYERS('light').filter((l) => (l as { 'source-layer'?: string })['source-layer'] !== 'pois').length);
    expect(style.layers.filter((l) => 'source' in l).every((l) => l.source === 'base')).toBe(true);
  });

  it('points every source, font and sprite at files on the phone and never at the network', () => {
    const style = buildStyle(input({ regions: [{ id: '34', tilesPath: 'files/34/tiles-0a0b0c0d.pmtiles' }, { id: '41', tilesPath: 'files/41/tiles-11223344.pmtiles' }] }));
    expect(style.sources.base).toMatchObject({ type: 'vector', url: `pmtiles://${ROOT}files/base-20261022/overview.pmtiles`, maxzoom: 8 });
    expect(style.sources.r34).toMatchObject({ type: 'vector', url: `pmtiles://${ROOT}files/34/tiles-0a0b0c0d.pmtiles`, maxzoom: 15 });
    expect(style.glyphs).toBe(`${ROOT}files/base-20261022/fonts-compact/{fontstack}/{range}.pbf`);
    expect(style.sprite).toBe(`${ROOT}files/base-20261022/sprites/v4/light`);
    expect(JSON.stringify(style)).not.toMatch(/https?:/);
    expect(style.sources.base?.attribution).toBe('© OpenStreetMap contributors, Overture Maps');
    expect(style.sources.r41?.attribution).toBe('© OpenStreetMap contributors, Overture Maps');
  });

  it('encodes spaces and non-ASCII characters in the folder', () => {
    const style = buildStyle(input({ rootUrl: 'file:///data/user/0/com.example/files/Harita Verisi/' }));
    expect(style.glyphs?.startsWith('file:///data/user/0/com.example/files/Harita%20Verisi/')).toBe(true);
    expect(buildStyle(input({ rootUrl: '/data/yuksi geo/' })).glyphs?.startsWith('file:///data/yuksi%20geo/')).toBe(true);
  });

  it.each([1, 2, 12])('has unique layer ids and known sources for %i provinces', (count) => {
    const regions = Array.from({ length: count }, (_, i) => ({ id: String(34 + i).padStart(2, '0'), tilesPath: `files/${34 + i}/tiles.pmtiles` }));
    const style = buildStyle(input({ regions }));
    const ids = style.layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const layer of style.layers) if (layer.source) expect(style.sources[layer.source]).toBeDefined();
    expect(style.layers.length).toBeLessThanOrEqual(1 + (FLAVOR_LAYERS('light').length - 1) * (1 + count) + 3 * count);
    expect(Object.keys(style.sources)).toEqual(['base', ...regions.map((r) => `r${r.id}`)]);
  });

  it('draws the semi-transparent layers from one source at a time', () => {
    for (const theme of ['light', 'dark'] as const) {
      const ids = semiTransparentLayerIds(theme);
      expect([...ids].sort()).toEqual(['buildings', 'landcover', 'landuse_park', 'landuse_urban_green', 'roads_rail']);
      const style = buildStyle(input({ theme, regions: [{ id: '34', tilesPath: 'a' }, { id: '41', tilesPath: 'b' }] }));
      for (const id of ids) {
        const base = style.layers.find((l) => l.id === `${id}@base`);
        const mine = style.layers.find((l) => l.id === `${id}@r34`);
        expect(base?.maxzoom).toBe(SEMI_TRANSPARENT_FROM_ZOOM);
        expect(mine?.minzoom).toBe(SEMI_TRANSPARENT_FROM_ZOOM);
      }
      const opaque = FLAVOR_LAYERS(theme).filter((l) => l.type !== 'background' && !ids.includes(l.id) && l.id !== 'roads_labels_minor');
      for (const layer of opaque) {
        expect(style.layers.find((l) => l.id === `${layer.id}@r34`)?.minzoom).toBe(layer.minzoom);
        expect(style.layers.find((l) => l.id === `${layer.id}@base`)?.maxzoom).toBe(layer.maxzoom);
      }
    }
  });

  it('puts the base layers first and each province after it, in plate order', () => {
    const style = buildStyle(input({ regions: [{ id: '41', tilesPath: 'b' }, { id: '34', tilesPath: 'a' }] }));
    const order = style.layers.filter((l) => l.source).map((l) => l.source);
    expect(order.indexOf('base')).toBe(0);
    expect(order.lastIndexOf('base')).toBeLessThan(order.indexOf('r34'));
    expect(order.lastIndexOf('r34')).toBeLessThan(order.indexOf('r41'));
    expect(style.layers[0]?.type).toBe('background');
  });

  it('differs between themes and gives the matching sprite', () => {
    const light = buildStyle(input({ theme: 'light' }));
    const dark = buildStyle(input({ theme: 'dark' }));
    expect(light.layers[0]?.paint).not.toEqual(dark.layers[0]?.paint);
    expect(dark.sprite?.endsWith('/sprites/v4/dark')).toBe(true);
  });

  it('labels in the asked language and falls back to Turkish for unusable codes', () => {
    const text = (lang: string): string => JSON.stringify(buildStyle(input({ lang })).layers);
    expect(text('ar')).toContain('name:ar');
    expect(text('de-DE')).toContain('name:de');
    expect(text('EN')).toContain('name:en');
    expect(text('')).toContain('name:tr');
    expect(text('1')).toContain('name:tr');
    expect(text('ar')).not.toContain('"name:tr"');
  });

  it('uses the compact font names the base pack ships', () => {
    const text = JSON.stringify(buildStyle(input()).layers);
    expect(text).not.toContain('Noto Sans');
    expect(text).toContain('NotoSansRegular');
  });

  it('is the same for the same input and does not share objects between layers', () => {
    const a = buildStyle(input());
    const b = buildStyle(input());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const first = a.layers.find((l) => l.id === 'water@base');
    const second = a.layers.find((l) => l.id === 'water@r34');
    expect(first?.paint).not.toBe(second?.paint);
  });

  it('stays small enough for twelve provinces', () => {
    const regions = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1).padStart(2, '0'), tilesPath: `files/${i}/tiles.pmtiles` }));
    expect(JSON.stringify(buildStyle(input({ regions }))).length).toBeLessThan(2_500_000);
  });
});

describe('neighbourhood labels', () => {
  const hoods = [
    { name: 'Çarşı', lng: 29.73515, lat: 38.300469 },
    { name: 'Hamam', lng: 29.754833, lat: 38.307203 },
  ];

  it('adds nothing when there are no labels', () => {
    const style = buildStyle(input());
    expect(style.sources.hoods).toBeUndefined();
    expect(style.layers.some((l) => l.id === 'hood-labels')).toBe(false);
    expect(buildStyle(input({ hoods: [] })).sources.hoods).toBeUndefined();
  });

  it('draws the names as a last symbol layer from the points given', () => {
    const style = buildStyle(input({ hoods }));
    expect(style.sources.hoods).toEqual({
      type: 'geojson',
      data: { type: 'FeatureCollection', features: hoods.map((h) => ({ type: 'Feature', properties: { name: h.name, label: h.name === 'Çarşı' ? 'ÇARŞI' : 'HAMAM' }, geometry: { type: 'Point', coordinates: [h.lng, h.lat] } })) },
    });
    const layer = style.layers.at(-1);
    expect(layer).toMatchObject({ id: 'hood-labels', type: 'symbol', source: 'hoods', minzoom: 12.5 });
    expect(layer?.layout).toMatchObject({ 'text-field': ['get', 'label'], 'text-font': ['NotoSansMedium'] });
    expect(JSON.stringify(style)).not.toMatch(/https?:/);
  });

  it('takes its colours from the theme', () => {
    const light = buildStyle(input({ hoods, theme: 'light' })).layers.at(-1)?.paint;
    const dark = buildStyle(input({ hoods, theme: 'dark' })).layers.at(-1)?.paint;
    expect(light?.['text-color']).not.toBe(dark?.['text-color']);
    expect(light?.['text-halo-color']).not.toBe(dark?.['text-halo-color']);
  });

  it('skips empty names, bad coordinates and repeats and keeps the order it was given', () => {
    const messy = [{ name: ' ', lng: 29, lat: 38 }, { name: 'A', lng: Number.NaN, lat: 38 }, { name: 'B', lng: 29, lat: Infinity }, { ...hoods[1]! }, { ...hoods[0]! }, { ...hoods[0]! }];
    const features = (buildStyle(input({ hoods: messy })).sources.hoods?.data as { features: { properties: { name: string } }[] }).features;
    expect(features.map((f) => f.properties.name)).toEqual(['Hamam', 'Çarşı']);
  });

  it('draws no labels when there is no base pack to provide fonts', () => {
    expect(buildStyle(input({ baseDir: null, hoods })).sources).toEqual({});
  });
});

type Feature = { properties: Record<string, unknown> };

const shown = (layer: StyleLayer | undefined, properties: Record<string, unknown>, zoom: number): boolean => {
  const compiled = featureFilter(layer!.filter as never, 'layers[0].filter' as never);
  return compiled.filter({ zoom } as never, { type: 1, properties } as unknown as Feature as never);
};

const value = (layer: StyleLayer | undefined, where: 'layout' | 'paint', key: string, properties: Record<string, unknown>, zoom = 16, type: 'string' | 'number' | 'color' = 'string'): unknown => {
  const parsed = expression.createExpression((layer![where] as Record<string, unknown>)[key], { type, 'property-type': 'data-driven', expression: { interpolated: false, parameters: ['zoom', 'feature'] } } as never);
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value));
  return parsed.value.evaluate({ zoom } as never, { type: 1, properties } as never);
};

describe('service badges the base style no longer draws', () => {
  const regions = [{ id: '20', tilesPath: 'files/20/tiles-a.pmtiles' }, { id: '34', tilesPath: 'files/34/tiles-b.pmtiles' }];
  const layerOf = (id: string, extra: Partial<StyleInput> = {}) => buildStyle(input({ regions, ...extra })).layers.find((l) => l.id === id);

  it('adds one badge layer for each province map, from its own place layer', () => {
    for (const id of ['20', '34']) expect(layerOf(`service@r${id}`)).toMatchObject({ type: 'symbol', source: `r${id}`, 'source-layer': 'pois' });
    expect(buildStyle(input({ regions })).layers.some((l) => l.id.startsWith('service') && l.source === 'base')).toBe(false);
    expect(buildStyle(input({ regions: [] })).layers.some((l) => l.id.startsWith('service'))).toBe(false);
  });

  it('leaves the sprite icons of the base style out so nothing is drawn twice', () => {
    const layers = buildStyle(input({ regions })).layers;
    expect(layers.filter((l) => l['source-layer'] === 'pois' && !l.id.startsWith('service@'))).toEqual([]);
  });

  it('picks the glyph of the kind and shows nothing for kinds it has no glyph for', () => {
    const layer = layerOf('service@r20');
    expect(value(layer, 'layout', 'icon-image', { kind: 'pharmacy', name: 'x' })).toBe('geo-badge-pharmacy');
    expect(value(layer, 'layout', 'icon-image', { kind: 'park', name: 'x' })).toBe('geo-badge-park');
    expect(shown(layer, { kind: 'hospital', name: 'Devlet', min_zoom: 0 }, 15)).toBe(true);
    for (const kind of ['bench', 'tree', 'restaurant', 'cafe']) expect(shown(layer, { kind, name: 'x', min_zoom: 0 }, 18)).toBe(false);
  });

  it('shows important kinds earlier than ordinary ones and never before the zoom each place carries', () => {
    const layer = layerOf('service@r20');
    expect(shown(layer, { kind: 'hospital', name: 'x', min_zoom: 0 }, 14.9)).toBe(false);
    expect(shown(layer, { kind: 'hospital', name: 'x', min_zoom: 0 }, 15)).toBe(true);
    expect(shown(layer, { kind: 'park', name: 'x', min_zoom: 0 }, 15.9)).toBe(false);
    expect(shown(layer, { kind: 'park', name: 'x', min_zoom: 0 }, 16)).toBe(true);
    expect(shown(layer, { kind: 'bus_stop', name: 'x', min_zoom: 0 }, 17.6)).toBe(false);
    expect(shown(layer, { kind: 'bus_stop', name: 'x', min_zoom: 0 }, 17.8)).toBe(true);
    expect(shown(layer, { kind: 'hospital', name: 'x', min_zoom: 17 }, 16)).toBe(false);
    expect(shown(layer, { kind: 'hospital', min_zoom: 0 }, 17)).toBe(false);
  });

  it('writes the name in the map language, to the right of the badge', () => {
    const layout = layerOf('service@r20', { lang: 'de' })?.layout as Record<string, unknown>;
    expect(JSON.stringify(layout['text-field'])).toContain('name:de');
    expect(layout).toMatchObject({ 'text-anchor': 'left', 'text-optional': false, 'icon-allow-overlap': false, 'text-font': ['NotoSansMedium'] });
  });

  it('draws them above the base layers and below the neighbourhood names, with unique ids', () => {
    const ids = buildStyle(input({ regions, hoods: [{ name: 'Çarşı', lng: 29.7, lat: 38.3 }] })).layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.indexOf('service@r20')).toBeGreaterThan(ids.indexOf('roads_label_minor@r20'));
    expect(ids.indexOf('service@r34')).toBeLessThan(ids.indexOf('hood-labels'));
  });
});

describe('businesses from the places overlay', () => {
  const regions = [{ id: '20', tilesPath: 'files/20/tiles-a.pmtiles', placesPath: 'files/20/places-b.pmtiles' }, { id: '06', tilesPath: 'files/06/tiles-c.pmtiles' }];
  const style = (extra: Partial<StyleInput> = {}) => buildStyle(input({ regions, ...extra }));
  const layerOf = (id: string, extra: Partial<StyleInput> = {}) => style(extra).layers.find((l) => l.id === id);

  it('adds a source and one badge layer only for provinces that have the overlay file', () => {
    const built = style();
    expect(built.sources.ov20).toMatchObject({ type: 'vector', url: `pmtiles://${ROOT}files/20/places-b.pmtiles`, maxzoom: 16 });
    expect(built.sources.ov06).toBeUndefined();
    expect(built.layers.some((l) => l.source === 'ov06')).toBe(false);
    expect(built.layers.find((l) => l.id === 'ov-icon@ov20')).toMatchObject({ type: 'symbol', source: 'ov20', 'source-layer': 'places' });
    expect(built.layers.filter((l) => l.source === 'ov20').map((l) => l.id)).toEqual(['ov-icon@ov20']);
  });

  it('draws a round badge with the glyph of the category and the name beside it', () => {
    const layer = layerOf('ov-icon@ov20');
    expect(value(layer, 'layout', 'icon-image', { cat: 'cafe', g: 'food', name: 'x', c: 90 })).toBe('geo-badge-cafe');
    expect(value(layer, 'layout', 'icon-image', { cat: 'muslim_place_of_worship', g: 'worship', name: 'x', c: 90 })).toBe('geo-badge-mosque');
    expect(value(layer, 'layout', 'icon-image', { cat: 'osm_chain', g: 'market', b: 'migros', name: 'x', c: 90 })).toBe('geo-badge-grocery');
    expect(layer?.layout).toMatchObject({ 'icon-size': expect.anything(), 'text-size': 11, 'text-anchor': 'left', 'text-optional': false, 'icon-allow-overlap': false, 'text-font': ['NotoSansMedium'] });
    expect(layer?.paint).toMatchObject({ 'icon-halo-color': '#FFFFFF', 'icon-halo-width': 1 });
  });

  it('keeps cargo branches visible at street level, where chain places carry a confidence of 90', () => {
    const layer = layerOf('ov-icon@ov20');
    for (const b of ['yurtici', 'aras', 'mng', 'ptt']) expect(shown(layer, { cat: 'courier_and_delivery_services', g: 'other', b, name: 'x', c: 90 }, 16)).toBe(true);
    expect(shown(layer, { cat: 'courier_and_delivery_services', g: 'other', name: 'x', c: 90 }, 15)).toBe(false);
    expect(shown(layer, { cat: 'cafe', g: 'food', name: 'x', c: 90 }, 16)).toBe(false);
  });

  it('hides office-type businesses and places without a name', () => {
    const layer = layerOf('ov-icon@ov20');
    for (const cat of ['real_estate_agent', 'advertising_agency', 'manufacturer', 'professional_service']) expect(shown(layer, { cat, g: 'other', name: 'x', c: 99 }, 19)).toBe(false);
    expect(shown(layer, { cat: 'cafe', g: 'food', c: 99 }, 19)).toBe(false);
  });

  it('thins the map out like a map made for reading: few places far out, all of them close up', () => {
    const layer = layerOf('ov-icon@ov20');
    const at = (cat: string, g: string, c: number, zoom: number) => shown(layer, { cat, g, name: 'x', c }, zoom);
    expect(at('hospital', 'health', 50, 14)).toBe(false);
    expect(at('hospital', 'health', 50, 15)).toBe(true);
    expect(at('pharmacy', 'pharmacy', 97, 15)).toBe(false);
    expect(at('pharmacy', 'pharmacy', 98, 15)).toBe(true);
    expect(at('pharmacy', 'pharmacy', 87, 16)).toBe(false);
    expect(at('pharmacy', 'pharmacy', 88, 16)).toBe(true);
    expect(at('pharmacy', 'pharmacy', 50, 16.5)).toBe(true);
    expect(at('grocery_store', 'market', 99, 15)).toBe(false);
    expect(at('grocery_store', 'market', 100, 15)).toBe(true);
    expect(at('grocery_store', 'market', 94, 16)).toBe(false);
    expect(at('grocery_store', 'market', 95, 16)).toBe(true);
    expect(at('grocery_store', 'market', 50, 16.6)).toBe(false);
    expect(at('grocery_store', 'market', 92, 16.6)).toBe(true);
    expect(at('grocery_store', 'market', 88, 17)).toBe(false);
    expect(at('grocery_store', 'market', 89, 17)).toBe(true);
    expect(at('grocery_store', 'market', 50, 17.5)).toBe(true);
    expect(at('cafe', 'food', 99, 16.4)).toBe(false);
    expect(at('cafe', 'food', 99, 16.5)).toBe(true);
    expect(at('cafe', 'food', 98, 16.6)).toBe(false);
    expect(at('cafe', 'food', 97, 17.2)).toBe(true);
    expect(at('cafe', 'food', 90, 17.6)).toBe(false);
    expect(at('cafe', 'food', 94, 17.7)).toBe(true);
    expect(at('cafe', 'food', 89, 18)).toBe(true);
    expect(at('cafe', 'food', 77, 18.5)).toBe(false);
    expect(at('cafe', 'food', 78, 18.5)).toBe(true);
    expect(at('cafe', 'food', 10, 19)).toBe(true);
  });

  it('lets the important and surest places keep their label first', () => {
    const order = (cat: string, g: string, c: number) => value(layerOf('ov-icon@ov20'), 'layout', 'symbol-sort-key', { cat, g, c }, 16, 'number') as number;
    expect(order('hospital', 'health', 50)).toBeLessThan(order('grocery_store', 'market', 99));
    expect(order('grocery_store', 'market', 99)).toBeLessThan(order('cafe', 'food', 99));
    expect(order('cafe', 'food', 95)).toBeLessThan(order('cafe', 'food', 60));
  });

  it('writes the names in the map language', () => {
    expect(JSON.stringify(layerOf('ov-icon@ov20', { lang: 'en' })?.layout?.['text-field'])).toContain('name:en');
  });

  it('paints the badge in the colour of its group and the name in a darker tone of it', () => {
    const light = layerOf('ov-icon@ov20');
    const dark = layerOf('ov-icon@ov20', { theme: 'dark' });
    const pharmacy = { cat: 'pharmacy', g: 'pharmacy', name: 'x', c: 90 };
    const sum = (hex: unknown) => [1, 3, 5].reduce((total, at) => total + parseInt((hex as string).slice(at, at + 2), 16), 0);
    const fill = value(light, 'paint', 'icon-color', pharmacy);
    expect(fill).toBe('#EB4D6E');
    expect(sum(value(light, 'paint', 'text-color', pharmacy))).toBeLessThan(sum(fill));
    expect(sum(value(dark, 'paint', 'text-color', pharmacy))).toBeGreaterThan(sum(fill));
    expect(dark?.paint?.['text-halo-color']).toBe('#1B1B1D');
  });

  it('keeps chains in the same layer in category mode and gives them their own layers when logos are asked for', () => {
    expect(style().layers.some((l) => l.id.startsWith('ov-brand@'))).toBe(false);
    const logos = style({ look: resolveMapLook(DEFAULT_THEME.light.map, { brands: { mode: 'badge' } }) });
    expect(logos.layers.some((l) => l.id.startsWith('ov-brand@'))).toBe(true);
    const plain = logos.layers.find((l) => l.id === 'ov-icon@ov20');
    expect(shown(plain, { cat: 'osm_chain', g: 'market', b: 'migros', name: 'x', c: 90 }, 18)).toBe(false);
    expect(shown(plain, { cat: 'grocery_store', g: 'market', name: 'x', c: 90 }, 18)).toBe(true);
  });

  it('sits above the province layers and below the neighbourhood names, with unique ids', () => {
    const ids = style({ hoods: [{ name: 'Çarşı', lng: 29.7, lat: 38.3 }] }).layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.indexOf('ov-icon@ov20')).toBeGreaterThan(ids.indexOf('service@r20'));
    expect(ids.indexOf('ov-icon@ov20')).toBeLessThan(ids.indexOf('hood-labels'));
  });

  it('is a valid style', () => {
    const errors = validateStyleMin(style() as never);
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  it('builds quickly even with the long category rules', () => {
    const t0 = Date.now();
    for (let i = 0; i < 20; i += 1) style();
    expect((Date.now() - t0) / 20).toBeLessThan(25);
  });
});

describe('labels in languages the tiles rarely carry', () => {
  const text = (lang: string) => JSON.stringify(buildStyle(input({ lang, regions: [{ id: '34', tilesPath: 'files/34/tiles-0a0b0c0d.pmtiles' }] })).layers);

  it.each(['de', 'ar', 'el'])('never reads the %s name without trying the English one next', (lang) => {
    const style = text(lang);
    const plain = style.match(new RegExp(`\\["get","name:${lang}"\\](?!,\\["get","name:en"\\])`, 'g'));
    expect(plain).toBeNull();
    expect(style).toContain(`["get","name:${lang}"],["get","name:en"]`);
  });

  it('keeps our own labels in Russian and Turkish without an English step', () => {
    expect(text('ru')).toContain('["coalesce",["get","name:ru"],["get","name"]]');
    expect(text('tr')).toContain('["coalesce",["get","name:tr"],["get","name"]]');
  });
});

describe('hiding icons', () => {
  const withPlaces = (hide?: string[]) => buildStyle(input({ regions: [{ id: '34', tilesPath: 'files/34/tiles.pmtiles', placesPath: 'files/34/places.pmtiles' }], ...(hide ? { hide } : {}) }));
  const layer = (style: ReturnType<typeof buildStyle>, prefix: string) => style.layers.find((l) => l.id.startsWith(prefix))!;
  const place = { cat: 'cafe', g: 'food', name: 'x', c: 99 };

  it('leaves the style alone when nothing is hidden', () => {
    expect(JSON.stringify(withPlaces([]))).toBe(JSON.stringify(withPlaces()));
  });

  it('switches a whole icon class off', () => {
    const style = withPlaces(['places', 'services']);
    for (const prefix of ['ov-icon@', 'service@']) expect((layer(style, prefix).layout as Record<string, unknown>).visibility).toBe('none');
    expect((layer(withPlaces(['brands']), 'ov-icon@').layout as Record<string, unknown>).visibility).toBeUndefined();
  });

  it('takes chains and landmarks out of the badge layer', () => {
    const chain = { cat: 'osm_chain', g: 'market', b: 'migros', name: 'x', c: 99 };
    const landmark = { cat: 'historic_site', g: 'other', lm: 1, name: 'x', c: 99 };
    expect(shown(layer(withPlaces(), 'ov-icon@'), chain, 18)).toBe(true);
    expect(shown(layer(withPlaces(['brands']), 'ov-icon@'), chain, 18)).toBe(false);
    expect(shown(layer(withPlaces(['brands']), 'ov-icon@'), place, 18)).toBe(true);
    expect(shown(layer(withPlaces(), 'ov-icon@'), landmark, 18)).toBe(true);
    expect(shown(layer(withPlaces(['landmarks']), 'ov-icon@'), landmark, 18)).toBe(false);
  });

  it('filters one theme group out of the badges and the service badges', () => {
    const style = withPlaces(['group:cargo', 'group:health']);
    expect(shown(layer(style, 'ov-icon@'), { cat: 'freight_and_cargo_service', g: 'other', name: 'x', c: 99 }, 18)).toBe(false);
    expect(shown(layer(style, 'ov-icon@'), { cat: 'hospital', g: 'health', name: 'x', c: 99 }, 18)).toBe(false);
    expect(shown(layer(style, 'ov-icon@'), place, 18)).toBe(true);
    expect(shown(layer(style, 'service@'), { kind: 'hospital', name: 'x', min_zoom: 0 }, 18)).toBe(false);
    expect(shown(layer(style, 'service@'), { kind: 'park', name: 'x', min_zoom: 0 }, 18)).toBe(true);
  });

  it('filters single chains out', () => {
    const style = withPlaces(['chain:aras', 'chain:yurtici']);
    expect(shown(layer(style, 'ov-icon@'), { cat: 'osm_chain', g: 'cargo', b: 'aras', name: 'x', c: 99 }, 18)).toBe(false);
    expect(shown(layer(style, 'ov-icon@'), { cat: 'osm_chain', g: 'cargo', b: 'mng', name: 'x', c: 99 }, 18)).toBe(true);
  });

  it('produces a valid style with every kind of hiding', () => {
    const style = withPlaces(['group:cargo', 'chain:aras', 'landmarks', 'brands']);
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it('knows the cargo brands and the generic cargo glyph', () => {
    const text = JSON.stringify(withPlaces());
    expect(text).toContain('"post"');
    for (const id of ['yurtici', 'aras', 'mng', 'ptt', 'surat', 'hepsijet', 'trendyolexpress', 'ups', 'dhl']) expect(chains.some((c: { id: string }) => c.id === id)).toBe(true);
  });
});
