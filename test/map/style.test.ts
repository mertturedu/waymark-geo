import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps';
import { SEMI_TRANSPARENT_FROM_ZOOM, SERVICE_ICONS, buildStyle, semiTransparentLayerIds, type StyleInput } from '../../src/native/map/style';

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
    expect(style.layers.length).toBe(FLAVOR_LAYERS('light').length);
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
    expect(style.layers.length).toBeLessThanOrEqual(1 + (FLAVOR_LAYERS('light').length - 1) * (1 + count) + 2 * count);
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
      const opaque = FLAVOR_LAYERS(theme).filter((l) => l.type !== 'background' && !ids.includes(l.id));
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
      data: { type: 'FeatureCollection', features: hoods.map((h) => ({ type: 'Feature', properties: { name: h.name }, geometry: { type: 'Point', coordinates: [h.lng, h.lat] } })) },
    });
    const layer = style.layers.at(-1);
    expect(layer).toMatchObject({ id: 'hood-labels', type: 'symbol', source: 'hoods', minzoom: 12.5 });
    expect(layer?.layout).toMatchObject({ 'text-field': ['get', 'name'], 'text-font': ['NotoSansMedium'] });
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

describe('service places the base style does not draw', () => {
  const regions = [{ id: '20', tilesPath: 'files/20/tiles-a.pmtiles' }, { id: '34', tilesPath: 'files/34/tiles-b.pmtiles' }];
  const layerOf = (id: string, extra: Partial<StyleInput> = {}) => buildStyle(input({ regions, ...extra })).layers.find((l) => l.id === id);

  it('adds one icon and name layer for each province map, from its own place layer', () => {
    for (const id of ['20', '34']) expect(layerOf(`service@r${id}`)).toMatchObject({ type: 'symbol', source: `r${id}`, 'source-layer': 'pois' });
    expect(buildStyle(input({ regions })).layers.some((l) => l.id.startsWith('service') && l.source === 'base')).toBe(false);
    expect(buildStyle(input({ regions: [] })).layers.some((l) => l.id.startsWith('service'))).toBe(false);
  });

  it('shows hospitals, pharmacies, police, banks, fuel, places of worship and hotels but not schools or restaurants', () => {
    const filter = JSON.stringify(layerOf('service@r20')?.filter);
    for (const kind of ['hospital', 'clinic', 'pharmacy', 'police', 'fire_station', 'bank', 'fuel', 'place_of_worship', 'hotel', 'marketplace', 'kindergarten']) expect(filter).toContain(`"${kind}"`);
    for (const kind of ['school', 'restaurant', 'bench', 'tree']) expect(filter).not.toContain(`"${kind}"`);
  });

  it('picks the icon of the category and has a fallback icon', () => {
    const icon = JSON.stringify(layerOf('service@r20')?.layout?.['icon-image']);
    expect(icon.startsWith('["concat","geo-sdf-",["match",["get","kind"]')).toBe(true);
    expect(icon).toContain('"health"');
    expect(icon).toContain('"pharmacy"');
    expect(icon.endsWith('"public"]]')).toBe(true);
    for (const name of Object.keys(SERVICE_ICONS)) expect(icon).toContain(`"${name.slice(4)}"`);
  });

  it('puts every kind in one category only', () => {
    const all = Object.values(SERVICE_ICONS).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('follows the zoom each place carries, keeps the icon when there is no name and uses the base pack fonts', () => {
    const layer = layerOf('service@r20');
    expect(JSON.stringify(layer?.filter)).toContain('min_zoom');
    expect(layer?.layout).toMatchObject({ 'text-font': ['NotoSansRegular'], 'text-optional': true, 'icon-allow-overlap': false });
    expect(JSON.stringify(layer?.layout?.['symbol-sort-key'])).toContain('["get","min_zoom"]');
    expect(JSON.stringify(buildStyle(input({ regions })))).not.toContain('Noto Sans');
  });

  it('keeps the symbols small and the names quiet: names only close up, small muted text', () => {
    const layer = layerOf('service@r20');
    expect(layer?.layout?.['text-size']).toBeLessThanOrEqual(10);
    expect(JSON.stringify(layer?.layout?.['icon-size'])).toMatch(/^\["interpolate",\["linear"\],\["zoom"\],14,\["\*",0\.24,/);
    expect(JSON.stringify(layer?.layout?.['text-field'])).toContain('"step"');
    expect(JSON.stringify(layer?.layout?.['text-field'])).toContain(',16,');
    const other = layerOf('place-name@r20');
    expect(other?.layout?.['text-size']).toBeLessThanOrEqual(10);
    expect(JSON.stringify(other?.layout?.['text-field'])).toContain(',16,');
  });

  it('writes the name in the map language', () => {
    expect(JSON.stringify(layerOf('service@r20', { lang: 'ar' })?.layout?.['text-field'])).toContain('name:ar');
    expect(JSON.stringify(layerOf('service@r20', { lang: 'ar' })?.layout?.['text-field'])).not.toContain('name:tr');
  });

  it('draws them above the base layers and below the neighbourhood names, with unique ids', () => {
    const ids = buildStyle(input({ regions, hoods: [{ name: 'Çarşı', lng: 29.7, lat: 38.3 }] })).layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.indexOf('service@r20')).toBeGreaterThan(ids.indexOf('roads_labels_minor@r20'));
    expect(ids.indexOf('service@r34')).toBeLessThan(ids.indexOf('hood-labels'));
    expect(ids.at(-1)).toBe('hood-labels');
  });

  it('takes the text colours from the theme', () => {
    expect(layerOf('service@r20', { theme: 'light' })?.paint?.['text-color']).not.toBe(layerOf('service@r20', { theme: 'dark' })?.paint?.['text-color']);
  });
});

describe('every other named place', () => {
  const regions = [{ id: '20', tilesPath: 'files/20/tiles-a.pmtiles' }];
  const layer = () => buildStyle(input({ regions })).layers.find((l) => l.id === 'place-name@r20');

  it('adds a name layer from the place layer of each province map', () => {
    expect(layer()).toMatchObject({ type: 'symbol', source: 'r20', 'source-layer': 'pois' });
    expect(buildStyle(input({ regions: [] })).layers.some((l) => l.id.startsWith('place-name'))).toBe(false);
  });

  it('leaves out what the base style already draws, the critical service places and map noise', () => {
    const filter = JSON.stringify(layer()?.filter);
    for (const kind of ['restaurant', 'school', 'park', 'hospital', 'pharmacy', 'tree', 'crossing', 'traffic_signals', 'administrative', 'trunk', 'yes', 'living_street']) expect(filter).toContain(`"${kind}"`);
    expect(filter).toContain('"!"');
    expect(JSON.stringify(layer()?.filter)).toContain('min_zoom');
    expect(JSON.stringify(layer()?.filter)).toContain('"has","name"');
  });

  it('does not exclude shops, parking, housing estates or industrial sites', () => {
    const filter = JSON.stringify(layer()?.filter);
    for (const kind of ['jeweller', 'bakery', 'parking', 'residential', 'industrial', 'greengrocer', 'hotel_x']) expect(filter).not.toContain(`"${kind}"`);
  });

  it('puts the places with the lowest zoom first so the important ones keep their label', () => {
    expect(layer()?.layout).toMatchObject({ 'symbol-sort-key': ['get', 'min_zoom'], 'text-font': ['NotoSansRegular'], 'text-allow-overlap': false });
  });

  it('sits between the service places and the neighbourhood names', () => {
    const ids = buildStyle(input({ regions, hoods: [{ name: 'Çarşı', lng: 29.7, lat: 38.3 }] })).layers.map((l) => l.id);
    expect(ids.indexOf('service@r20')).toBeLessThan(ids.indexOf('place-name@r20'));
    expect(ids.indexOf('place-name@r20')).toBeLessThan(ids.indexOf('hood-labels'));
  });

  it('colours the text by theme', () => {
    const light = JSON.stringify(buildStyle(input({ regions, theme: 'light' })).layers.find((l) => l.id === 'place-name@r20')?.paint);
    const dark = JSON.stringify(buildStyle(input({ regions, theme: 'dark' })).layers.find((l) => l.id === 'place-name@r20')?.paint);
    expect(light).not.toBe(dark);
  });
});

describe('businesses from the places overlay', () => {
  const regions = [{ id: '20', tilesPath: 'files/20/tiles-a.pmtiles', placesPath: 'files/20/places-b.pmtiles' }, { id: '06', tilesPath: 'files/06/tiles-c.pmtiles' }];
  const style = () => buildStyle(input({ regions }));
  const layerOf = (id: string, extra: Partial<StyleInput> = {}) => buildStyle(input({ regions, ...extra })).layers.find((l) => l.id === id);

  it('adds a source and layers only for provinces that have the overlay file', () => {
    const built = style();
    expect(built.sources.ov20).toMatchObject({ type: 'vector', url: `pmtiles://${ROOT}files/20/places-b.pmtiles`, maxzoom: 16 });
    expect(built.sources.ov06).toBeUndefined();
    expect(built.layers.some((l) => l.source === 'ov06')).toBe(false);
    for (const id of ['ov-icon@ov20', 'ov-name@ov20']) expect(built.layers.find((l) => l.id === id)).toMatchObject({ type: 'symbol', source: 'ov20', 'source-layer': 'places' });
  });

  it('draws an icon for each business group with its own picture and a quiet name close up', () => {
    const layer = layerOf('ov-icon@ov20');
    const filter = JSON.stringify(layer?.filter);
    for (const group of ['health', 'pharmacy', 'safety', 'money', 'fuel', 'worship', 'lodging', 'market', 'public', 'food', 'shop']) expect(filter).toContain(`"${group}"`);
    expect(filter).not.toContain('"other"');
    expect(JSON.stringify(layer?.layout?.['icon-image'])).toBe('["concat","geo-sdf-",["get","g"]]');
    expect(JSON.stringify(layer?.layout?.['icon-size'])).toMatch(/^\["interpolate",\["linear"\],\["zoom"\],14,\["\*",0\.24,/);
    expect(layer?.layout).toMatchObject({ 'text-size': 10, 'text-optional': true, 'icon-allow-overlap': false, 'text-font': ['NotoSansRegular'] });
    expect(JSON.stringify(layer?.layout?.['text-field'])).toContain(',16,');
  });

  it('draws chain stores with their brand badge and keeps them out of the plain business icons', () => {
    const brand = layerOf('ov-brand@ov20');
    expect(JSON.stringify(brand?.filter)).toContain('["has","b"]');
    expect(JSON.stringify(brand?.layout?.['icon-image'])).toContain('"geo-sdf-badge"');
    expect(JSON.stringify(layerOf('ov-brand@ov20:logo')?.layout?.['icon-image'])).toBe('["concat","geo-brand-",["get","b"]]');
    expect(JSON.stringify(layerOf('ov-icon@ov20')?.filter)).toContain('["!",["has","b"]]');
  });

  it('draws landmarks with their own icon and names them from zoom 14', () => {
    const landmark = layerOf('ov-landmark@ov20');
    expect(landmark?.layout?.['icon-image']).toBe('geo-sdf-landmark');
    expect(JSON.stringify(landmark?.layout?.['text-field'])).toContain(',14,');
    expect(JSON.stringify(layerOf('ov-icon@ov20')?.filter)).toContain('["!",["has","lm"]]');
  });

  it('lets the surest places keep their label first', () => {
    expect(JSON.stringify(layerOf('ov-icon@ov20')?.layout?.['symbol-sort-key'])).toContain('["-",100,["get","c"]]');
  });

  it('writes the names of the other businesses only from the closest zoom', () => {
    const layer = layerOf('ov-name@ov20');
    expect(JSON.stringify(layer?.filter)).toContain('"other"');
    expect(JSON.stringify(layer?.layout?.['text-field'])).toContain(',17,');
    expect(layer?.layout?.['text-size']).toBeLessThanOrEqual(10);
  });

  it('writes the names in the map language', () => {
    expect(JSON.stringify(layerOf('ov-icon@ov20', { lang: 'ar' })?.layout?.['text-field'])).toContain('name:ar');
  });

  it('sits above the province layers and below the neighbourhood names, with unique ids', () => {
    const ids = buildStyle(input({ regions, hoods: [{ name: 'Çarşı', lng: 29.7, lat: 38.3 }] })).layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.indexOf('ov-icon@ov20')).toBeGreaterThan(ids.indexOf('place-name@r20'));
    expect(ids.indexOf('ov-name@ov20')).toBeLessThan(ids.indexOf('hood-labels'));
  });

  it('is a valid style', () => {
    const errors = validateStyleMin(buildStyle(input({ regions })) as never);
    expect(errors.map((e) => e.message)).toEqual([]);
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

  it('leaves the style alone when nothing is hidden', () => {
    expect(JSON.stringify(withPlaces([]))).toBe(JSON.stringify(withPlaces()));
  });

  it('switches a whole icon class off', () => {
    const style = withPlaces(['brands', 'landmarks', 'places', 'services']);
    for (const prefix of ['ov-brand@', 'ov-landmark@', 'ov-icon@', 'service@']) expect((layer(style, prefix).layout as Record<string, unknown>).visibility).toBe('none');
    expect((layer(withPlaces(['brands']), 'ov-icon@').layout as Record<string, unknown>).visibility).toBeUndefined();
  });

  it('filters one group out of business icons, brand badges and service icons', () => {
    const style = withPlaces(['group:cargo', 'group:health']);
    expect(JSON.stringify(layer(style, 'ov-brand@').filter)).toContain('["!",["in",["get","g"],["literal",["cargo","health"]]]]');
    expect(JSON.stringify(layer(style, 'ov-icon@').filter)).toContain('"cargo","health"');
    expect(JSON.stringify(layer(style, 'service@').filter)).toContain('hospital');
  });

  it('filters single chains out of brand badges only', () => {
    const style = withPlaces(['chain:aras', 'chain:yurtici']);
    expect(JSON.stringify(layer(style, 'ov-brand@').filter)).toContain('["literal",["aras","yurtici"]]');
    expect(JSON.stringify(layer(style, 'ov-icon@').filter)).not.toContain('aras');
  });

  it('produces a valid style with every kind of hiding', () => {
    const style = withPlaces(['group:cargo', 'chain:aras', 'landmarks']);
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it('knows the cargo brands and the generic cargo icon', () => {
    const text = JSON.stringify(withPlaces());
    expect(text).toContain('"cargo"');
    for (const id of ['yurtici', 'aras', 'mng', 'ptt', 'surat', 'hepsijet', 'trendyolexpress', 'ups', 'dhl']) expect(require('../../src/native/map/chains.json').some((c: { id: string }) => c.id === id)).toBe(true);
  });
});
