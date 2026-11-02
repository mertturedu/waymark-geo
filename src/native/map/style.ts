import chains from './chains.json';
import { DEFAULT_THEME, hiddenTokens, iconColor, ICON_GROUPS, type IconGroup, type ResolvedMapLook } from './theme';
import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps';

export type StyleLayer = { id: string; type: string; source?: string; minzoom?: number; maxzoom?: number; paint?: Record<string, unknown>; layout?: Record<string, unknown>; [key: string]: unknown };
export type MapStyle = {
  version: 8;
  sources: Record<string, Record<string, unknown>>;
  glyphs?: string;
  sprite?: string;
  layers: StyleLayer[];
};

export type StyleInput = {
  rootUrl: string;
  baseDir: string | null;
  regions: { id: string; tilesPath: string; placesPath?: string }[];
  theme: 'light' | 'dark';
  lang: string;
  hide?: string[];
  hoods?: { name: string; lng: number; lat: number }[];
  look?: ResolvedMapLook;
  accent?: string;
};

export const SEMI_TRANSPARENT_FROM_ZOOM = 9;
const BASE_MAX_ZOOM = 8;
const REGION_MAX_ZOOM = 15;
const OVERLAY_MAX_ZOOM = 16;
const ATTRIBUTION = '© OpenStreetMap contributors, Overture Maps';

const fileUrl = (value: string): string => {
  if (value.startsWith('file://')) return value.replace(/[^\x21-\x7e]+/g, (run) => encodeURIComponent(run));
  return `file://${encodeURI(value)}`;
};

const cleanLang = (lang: string): string => {
  const code = (lang ?? '').slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : 'tr';
};

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const ENGLISH_BEHIND = ['de', 'ar', 'el'];

const nameOf = (lang: string): unknown[] => (ENGLISH_BEHIND.includes(lang) ? ['coalesce', ['get', `name:${lang}`], ['get', 'name:en'], ['get', 'name']] : ['coalesce', ['get', `name:${lang}`], ['get', 'name']]);

const behindEnglish = (layers: StyleLayer[], lang: string): StyleLayer[] => {
  if (!ENGLISH_BEHIND.includes(lang)) return layers;
  const plain = `["get","name:${lang}"]`;
  const text = JSON.stringify(layers).split(`${plain},["get","name:en"]`).join('\u0000').split(plain).join(`["coalesce",${plain},["get","name:en"]]`).split('\u0000').join(`${plain},["get","name:en"]`);
  return JSON.parse(text) as StyleLayer[];
};

const renamed = (layers: StyleLayer[], from: string, to: string): StyleLayer[] => JSON.parse(JSON.stringify(layers).split(`name:${from}`).join(`name:${to}`)) as StyleLayer[];

const flavorLayers = (theme: 'light' | 'dark', lang: string): StyleLayer[] => {
  const base = lang === 'ar' ? renamed(protomapsLayers('protomaps', namedFlavor(theme), { lang: 'de' }) as unknown as StyleLayer[], 'de', 'ar') : (protomapsLayers('protomaps', namedFlavor(theme), { lang }) as unknown as StyleLayer[]);
  return behindEnglish(base, lang);
};

const isSemiTransparent = (layer: StyleLayer): boolean => Object.keys(layer.paint ?? {}).some((key) => /opacity/.test(key));

export function semiTransparentLayerIds(theme: 'light' | 'dark'): string[] {
  return flavorLayers(theme, 'tr').filter(isSemiTransparent).map((layer) => layer.id);
}

const compactFonts = (layers: StyleLayer[]): StyleLayer[] =>
  JSON.parse(JSON.stringify(layers).replace(/Noto Sans Devanagari Regular v1/g, 'Noto Sans Regular').replace(/Noto Sans (Regular|Medium|Italic)/g, 'NotoSans$1')) as StyleLayer[];

const HOOD_MIN_ZOOM = 12.5;
const NAME_MIN_ZOOM = 16;

export const SERVICE_ICONS: Record<string, string[]> = {
  'geo-health': ['hospital', 'clinic', 'doctors', 'dentist', 'medical', 'medical_supply'],
  'geo-pharmacy': ['pharmacy'],
  'geo-safety': ['police', 'fire_station', 'courthouse', 'prison'],
  'geo-money': ['bank', 'atm', 'money_transfer', 'bureau_de_change'],
  'geo-fuel': ['fuel', 'car_wash', 'car_repair'],
  'geo-worship': ['place_of_worship', 'religious'],
  'geo-lodging': ['hotel', 'motel', 'hostel', 'guest_house'],
  'geo-market': ['marketplace', 'mall', 'department_store'],
  'geo-public': ['public_building', 'kindergarten', 'college', 'bus_station', 'community_centre', 'cemetery', 'public_bath', 'turkish_bath'],
};

const SERVICE_KINDS = Object.values(SERVICE_ICONS).flat();

const DRAWN_BY_BASE = 'beach forest marina park peak zoo garden bench aerodrome station bus_stop ferry_terminal stadium university library school animal toilets drinking_water post_office building townhall restaurant fast_food cafe bar supermarket convenience books beauty electronics clothes attraction museum theatre artwork'.split(' ');

const MAP_NOISE = 'tree crossing traffic_signals street_lamp give_way stop switch ticket_validator elevator waste_basket bicycle_parking buffer_stop derail level_crossing railway_crossing tram_crossing tram_level_crossing turning_loop turning_circle mini_roundabout speed_camera parking_entrance lighting post_box telephone vending_machine recycling waste_disposal shelter traffic_mirror administrative place trunk living_street pedestrian yes proposed construction platform other commercial left_luggage clock'.split(' ');

export const BRAND_IDS: string[] = chains.map((chain) => chain.id);

export const BRAND_ICONS = BRAND_IDS.map((id) => `geo-brand-${id}`);

export const BUSINESS_ICONS = ['geo-food', 'geo-shop', 'geo-landmark', 'geo-cargo'];

export const SDF_ICONS = [...ICON_GROUPS.map((group) => `geo-sdf-${group}`), 'geo-sdf-badge', 'geo-sdf-badge-rounded'];

const BUSINESS_GROUPS = ['health', 'pharmacy', 'safety', 'money', 'fuel', 'worship', 'lodging', 'market', 'public', 'food', 'shop', 'cargo'];

const ICON_SIZE = { near: 0.36, far: 0.24 };
const BADGE_SIZE = { from: 0.4, to: 0.46 };
const LOGO_SIZE = { from: 0.22, to: 0.25 };
const LEGACY_LOGO_SIZE = { far: 0.38, near: 0.55 };
const EMPHASIS_SIZE = { strong: 1.1, normal: 1, quiet: 0.88 };
const EMPHASIS_ORDER = { strong: 0, normal: 100, quiet: 200 };
const QUIET_FROM_ZOOM = 16;
const ICON_PADDING = 4;

type Paint = { look: ResolvedMapLook; theme: 'light' | 'dark'; accent: string };

const groupsWith = (look: ResolvedMapLook, emphasis: 'strong' | 'quiet'): string[] => ICON_GROUPS.filter((group) => look.icons.groups[group].emphasis === emphasis);

const byGroup = (input: unknown, values: (group: IconGroup) => unknown, fallback: unknown): unknown[] => ['match', input, ...ICON_GROUPS.flatMap((group) => [group, values(group)]), fallback];

const colorByGroup = (paint: Paint, input: unknown): unknown[] => byGroup(input, (group) => iconColor(paint.look, group, paint.theme, paint.accent), iconColor(paint.look, 'public', paint.theme, paint.accent));

const chainIds = (look: ResolvedMapLook): string[] => Object.keys(look.brands.chains);

const byChain = (look: ResolvedMapLook, values: (id: string) => unknown, fallback: unknown): unknown[] => {
  const ids = chainIds(look);
  return ids.length === 0 ? (fallback as unknown[]) : ['match', ['get', 'b'], ...ids.flatMap((id) => [id, values(id)]), fallback];
};

const chainGroup = (look: ResolvedMapLook): unknown[] => byChain(look, (id) => look.brands.chains[id]!.group, ['coalesce', ['get', 'g'], 'shop']);

const sizeOf = (look: ResolvedMapLook, input: unknown): unknown[] =>
  byGroup(input, (group) => EMPHASIS_SIZE[look.icons.groups[group].emphasis] * look.icons.scale, look.icons.scale);

const iconSize = (look: ResolvedMapLook, input: unknown): unknown[] => ['interpolate', ['linear'], ['zoom'], 14, ['*', ICON_SIZE.far, sizeOf(look, input)], 17, ['*', ICON_SIZE.near, sizeOf(look, input)]];

const sortKey = (look: ResolvedMapLook, input: unknown, rest: unknown): unknown[] => ['+', byGroup(input, (group) => EMPHASIS_ORDER[look.icons.groups[group].emphasis], 100), rest];

const quietGate = (look: ResolvedMapLook, input: unknown): unknown[] => {
  const quiet = groupsWith(look, 'quiet');
  return quiet.length === 0 ? ['literal', true] : ['any', ['!', ['in', input, ['literal', quiet]]], ['>=', ['zoom'], QUIET_FROM_ZOOM]];
};

const halo = (theme: 'light' | 'dark') => ({ 'icon-halo-color': theme === 'dark' ? '#1B1B1D' : '#FFFFFF', 'icon-halo-width': 1.2 });

const letterSize = (text: string): number => {
  const length = [...text].length;
  return length <= 1 ? 10 : length === 2 ? 8.5 : 7;
};

const ascending = (stops: [number, unknown][]): unknown[] => {
  const kept: [number, unknown][] = [];
  for (const [zoom, value] of stops) if (kept.length === 0 || zoom > kept[kept.length - 1]![0]) kept.push([zoom, value]);
  return kept.flat();
};

function brandLayers(sourceName: string, paint: Paint, nameLayout: Record<string, unknown>, textPaint: Record<string, unknown>): StyleLayer[] {
  const { look } = paint;
  const { mode, badgeFrom, logoFrom } = look.brands;
  const scale = look.icons.scale;
  const group = chainGroup(look);
  const category = ['concat', 'geo-sdf-', group];
  const badge = look.brands.shape === 'rounded' ? 'geo-sdf-badge-rounded' : 'geo-sdf-badge';
  const groupColor = colorByGroup(paint, group);
  const fill = byChain(look, (id) => look.brands.chains[id]!.fill, groupColor);
  const ink = byChain(look, (id) => look.brands.chains[id]!.ink, '#FFFFFF');
  const letter = byChain(look, (id) => look.brands.chains[id]!.text, '');
  const letterSizes = byChain(look, (id) => letterSize(look.brands.chains[id]!.text) * scale, 9 * scale);
  const sort = ['-', 100, ['get', 'c']];
  const base = { type: 'symbol', source: sourceName, 'source-layer': 'places', filter: ['has', 'b'] };
  const logo = (minzoom: number | null, size: unknown[]): StyleLayer => ({
    ...base,
    id: `ov-brand@${sourceName}:logo`,
    ...(minzoom === null ? {} : { minzoom }),
    layout: { 'icon-image': ['concat', 'geo-brand-', ['get', 'b']], 'icon-size': size, 'icon-allow-overlap': false, 'icon-padding': ICON_PADDING, ...nameLayout, 'symbol-sort-key': sort },
    paint: textPaint,
  });
  const sdfBase = { ...base, filter: ['all', ['has', 'b'], quietGate(look, group)] };
  const categoryOnly = (maxzoom: number | null): StyleLayer => ({
    ...sdfBase,
    id: `ov-brand@${sourceName}`,
    ...(maxzoom === null ? {} : { maxzoom }),
    layout: { 'icon-image': category, 'icon-size': iconSize(look, group), 'icon-allow-overlap': false, 'icon-padding': ICON_PADDING, 'symbol-sort-key': sortKey(look, group, sort) },
    paint: { 'icon-color': groupColor, ...halo(paint.theme) },
  });
  if (mode === 'hidden') return [{ ...categoryOnly(null), layout: { ...categoryOnly(null).layout, visibility: 'none' } }];
  if (mode === 'category') return [categoryOnly(null)];
  if (mode === 'logo') return [logo(null, ['interpolate', ['linear'], ['zoom'], 14, LEGACY_LOGO_SIZE.far * scale, 17, LEGACY_LOGO_SIZE.near * scale])];
  const far = ICON_SIZE.far * scale;
  const near = ICON_SIZE.near * scale;
  const badgeLayer: StyleLayer = {
    ...sdfBase,
    id: `ov-brand@${sourceName}`,
    ...(mode === 'ladder' ? { maxzoom: logoFrom } : {}),
    layout: {
      'icon-image': ['step', ['zoom'], category, badgeFrom, badge],
      'icon-size': ['interpolate', ['linear'], ['zoom'], ...ascending([[14, far], [badgeFrom - 0.01, far + ((near - far) * (badgeFrom - 14)) / 3], [badgeFrom, BADGE_SIZE.from * scale], [badgeFrom + 2, BADGE_SIZE.to * scale]])],
      'icon-allow-overlap': false,
      'icon-padding': ICON_PADDING,
      'text-field': ['step', ['zoom'], '', badgeFrom, letter],
      'text-font': ['NotoSansMedium'],
      'text-size': letterSizes,
      'text-anchor': 'center',
      'text-offset': [0, 0],
      'text-padding': 0,
      'text-optional': false,
      'icon-optional': false,
      'symbol-sort-key': sortKey(look, group, sort),
    },
    paint: { 'icon-color': ['step', ['zoom'], groupColor, badgeFrom, fill], ...halo(paint.theme), 'text-color': ink },
  };
  if (mode === 'badge') return [badgeLayer];
  return [badgeLayer, logo(logoFrom, ['interpolate', ['linear'], ['zoom'], logoFrom, LOGO_SIZE.from * scale, logoFrom + 1.5, LOGO_SIZE.to * scale])];
}

function businessLayers(sourceName: string, paint: Paint, lang: string): StyleLayer[] {
  const { look, theme } = paint;
  const dark = theme === 'dark';
  const name = nameOf(lang);
  const haloColor = dark ? '#1b1b1d' : '#ffffff';
  const group = ['get', 'g'];
  const textPaint = { 'text-color': dark ? '#b4b4bd' : '#55555e', 'text-halo-color': haloColor, 'text-halo-width': 1.2 };
  const nameLayout = { 'text-field': ['step', ['zoom'], '', NAME_MIN_ZOOM, name], 'text-font': ['NotoSansRegular'], 'text-size': 10, 'text-anchor': 'top', 'text-offset': [0, 0.9], 'text-max-width': 8, 'text-optional': true };
  const sort = ['-', 100, ['get', 'c']];
  return [
    {
      id: `ov-icon@${sourceName}`,
      type: 'symbol',
      source: sourceName,
      'source-layer': 'places',
      filter: ['all', ['in', ['get', 'g'], ['literal', BUSINESS_GROUPS]], ['!', ['has', 'b']], ['!', ['has', 'lm']], quietGate(look, group)],
      layout: {
        'icon-image': ['concat', 'geo-sdf-', group],
        'icon-size': iconSize(look, group),
        'icon-allow-overlap': false,
        'icon-padding': ICON_PADDING,
        ...nameLayout,
        'symbol-sort-key': sortKey(look, group, sort),
      },
      paint: { 'icon-color': colorByGroup(paint, group), ...halo(theme), ...textPaint },
    },
    ...brandLayers(sourceName, paint, nameLayout, textPaint),
    {
      id: `ov-landmark@${sourceName}`,
      type: 'symbol',
      source: sourceName,
      'source-layer': 'places',
      filter: ['all', ['has', 'lm'], ['!', ['has', 'b']]],
      layout: {
        'icon-image': 'geo-sdf-landmark',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.26 * look.icons.scale, 17, 0.4 * look.icons.scale],
        'icon-allow-overlap': false,
        'icon-padding': ICON_PADDING,
        'text-field': ['step', ['zoom'], '', 14, name],
        'text-font': ['NotoSansMedium'],
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-max-width': 8,
        'text-optional': true,
        'symbol-sort-key': sort,
      },
      paint: { 'icon-color': iconColor(look, 'landmark', theme, paint.accent), ...halo(theme), 'text-color': dark ? '#c9c4e8' : '#4B3F8F', 'text-halo-color': haloColor, 'text-halo-width': 1.3 },
    },
    {
      id: `ov-name@${sourceName}`,
      type: 'symbol',
      source: sourceName,
      'source-layer': 'places',
      filter: ['==', ['get', 'g'], 'other'],
      layout: { 'text-field': ['step', ['zoom'], '', 17, name], 'text-font': ['NotoSansRegular'], 'text-size': 10, 'text-max-width': 8, 'text-allow-overlap': false, 'symbol-sort-key': sort },
      paint: { 'text-color': dark ? '#9c9ca6' : '#7a7a84', 'text-halo-color': haloColor, 'text-halo-width': 1.1 },
    },
  ];
}

const NOT_PLACE_NAMES = [...new Set([...DRAWN_BY_BASE, ...MAP_NOISE, ...SERVICE_KINDS])];

const kindGroup = (): unknown[] => ['match', ['get', 'kind'], ...Object.entries(SERVICE_ICONS).flatMap(([icon, kinds]) => [kinds, icon.slice(4)]), 'public'];

function serviceLayers(sourceName: string, paint: Paint, lang: string): StyleLayer[] {
  const { look, theme } = paint;
  const dark = theme === 'dark';
  const group = kindGroup();
  const shown = ['all', ['in', ['get', 'kind'], ['literal', SERVICE_KINDS]], ['>=', ['zoom'], ['get', 'min_zoom']], quietGate(look, group)];
  return [
    {
      id: `service@${sourceName}`,
      type: 'symbol',
      source: sourceName,
      'source-layer': 'pois',
      filter: shown,
      layout: {
        'icon-image': ['concat', 'geo-sdf-', group],
        'icon-size': iconSize(look, group),
        'icon-allow-overlap': false,
        'icon-padding': ICON_PADDING,
        'text-field': ['step', ['zoom'], '', NAME_MIN_ZOOM, nameOf(lang)],
        'text-font': ['NotoSansRegular'],
        'text-size': 10,
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-max-width': 8,
        'text-optional': true,
        'symbol-sort-key': sortKey(look, group, ['get', 'min_zoom']),
      },
      paint: { 'icon-color': colorByGroup(paint, group), ...halo(theme), 'text-color': dark ? '#b4b4bd' : '#55555e', 'text-halo-color': dark ? '#1b1b1d' : '#ffffff', 'text-halo-width': 1.2 },
    },
    {
      id: `place-name@${sourceName}`,
      type: 'symbol',
      source: sourceName,
      'source-layer': 'pois',
      filter: ['all', ['!', ['in', ['get', 'kind'], ['literal', NOT_PLACE_NAMES]]], ['>=', ['zoom'], ['get', 'min_zoom']], ['has', 'name']],
      layout: { 'text-field': ['step', ['zoom'], '', NAME_MIN_ZOOM, nameOf(lang)], 'text-font': ['NotoSansRegular'], 'text-size': 10, 'text-max-width': 8, 'text-allow-overlap': false, 'symbol-sort-key': ['get', 'min_zoom'] },
      paint: { 'text-color': dark ? '#9c9ca6' : '#7a7a84', 'text-halo-color': dark ? '#1b1b1d' : '#ffffff', 'text-halo-width': 1.1 },
    },
  ];
}

function hoodLayer(hoods: NonNullable<StyleInput['hoods']>, theme: 'light' | 'dark'): { source: Record<string, unknown>; layer: StyleLayer } | null {
  const seen = new Set<string>();
  const features = hoods
    .map((h) => ({ name: h.name.trim(), lng: h.lng, lat: h.lat }))
    .filter((h) => h.name !== '' && Number.isFinite(h.lng) && Number.isFinite(h.lat))
    .filter((h) => !seen.has(`${h.name}|${h.lng}|${h.lat}`) && seen.add(`${h.name}|${h.lng}|${h.lat}`))
    .map((h) => ({ type: 'Feature', properties: { name: h.name }, geometry: { type: 'Point', coordinates: [h.lng, h.lat] } }));
  if (features.length === 0) return null;
  const dark = theme === 'dark';
  return {
    source: { type: 'geojson', data: { type: 'FeatureCollection', features } },
    layer: {
      id: 'hood-labels',
      type: 'symbol',
      source: 'hoods',
      minzoom: HOOD_MIN_ZOOM,
      layout: { 'text-field': ['get', 'name'], 'text-font': ['NotoSansMedium'], 'text-size': ['interpolate', ['linear'], ['zoom'], HOOD_MIN_ZOOM, 10, 16, 14], 'text-max-width': 7 },
      paint: { 'text-color': dark ? '#d8d8dc' : '#5c4a3a', 'text-halo-color': dark ? '#1b1b1d' : '#ffffff', 'text-halo-width': 1.3 },
    },
  };
}

const CLASS_HIDES: Record<string, string> = { brands: 'ov-brand@', landmarks: 'ov-landmark@', places: 'ov-icon@', services: 'service@' };

function applyHide(layers: StyleLayer[], hide: string[]): StyleLayer[] {
  const classes = hide.filter((token) => token in CLASS_HIDES).map((token) => CLASS_HIDES[token]!);
  const groups = hide.filter((token) => token.startsWith('group:')).map((token) => token.slice(6));
  const chains = hide.filter((token) => token.startsWith('chain:')).map((token) => token.slice(6));
  const kinds = groups.flatMap((group) => SERVICE_ICONS[`geo-${group}`] ?? []);
  const narrow = (layer: StyleLayer, extra: unknown[]): StyleLayer => ({ ...layer, filter: layer.filter ? ['all', layer.filter, ...extra] : ['all', ...extra] });
  return layers.map((layer) => {
    if (classes.some((prefix) => layer.id.startsWith(prefix))) return { ...layer, layout: { ...(layer.layout ?? {}), visibility: 'none' } };
    if (layer.id.startsWith('ov-icon@') || layer.id.startsWith('ov-brand@')) {
      const extra: unknown[] = [];
      if (groups.length > 0) extra.push(['!', ['in', ['get', 'g'], ['literal', groups]]]);
      if (chains.length > 0 && layer.id.startsWith('ov-brand@')) extra.push(['!', ['in', ['get', 'b'], ['literal', chains]]]);
      return extra.length > 0 ? narrow(layer, extra) : layer;
    }
    if (layer.id.startsWith('service@') && kinds.length > 0) return narrow(layer, [['!', ['in', ['get', 'kind'], ['literal', kinds]]]]);
    return layer;
  });
}

export function buildStyle(input: StyleInput): MapStyle {
  const style = assembleStyle(input);
  const hide = [...new Set([...(input.hide ?? []), ...hiddenTokens(input.look ?? DEFAULT_THEME[input.theme].map)])];
  return hide.length > 0 ? { ...style, layers: applyHide(style.layers, hide) } : style;
}

function assembleStyle(input: StyleInput): MapStyle {
  const root = fileUrl(input.rootUrl).replace(/\/$/, '');
  const lang = cleanLang(input.lang);
  const paint: Paint = { look: input.look ?? DEFAULT_THEME[input.theme].map, theme: input.theme, accent: input.accent ?? DEFAULT_THEME[input.theme].colors.accent };
  const flavored = compactFonts(flavorLayers(input.theme, lang));
  const background = flavored.filter((layer) => layer.type === 'background');
  const drawn = flavored.filter((layer) => layer.type !== 'background');
  if (input.baseDir === null) return { version: 8, sources: {}, layers: copy(background) };

  const baseRoot = `${root}/${encodeURI(input.baseDir)}`;
  const sources: MapStyle['sources'] = {
    base: { type: 'vector', url: `pmtiles://${baseRoot}/overview.pmtiles`, attribution: ATTRIBUTION, maxzoom: BASE_MAX_ZOOM },
  };
  const layers: StyleLayer[] = copy(background);
  const clone = (sourceName: string, side: 'base' | 'region'): void => {
    for (const layer of drawn) {
      const next = copy(layer);
      next.id = `${layer.id}@${sourceName}`;
      next.source = sourceName;
      if (isSemiTransparent(layer)) {
        if (side === 'base') next.maxzoom = Math.min(layer.maxzoom ?? Infinity, SEMI_TRANSPARENT_FROM_ZOOM);
        else next.minzoom = Math.max(layer.minzoom ?? 0, SEMI_TRANSPARENT_FROM_ZOOM);
      }
      layers.push(next);
    }
  };
  clone('base', 'base');
  for (const region of [...input.regions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const name = `r${region.id}`;
    sources[name] = { type: 'vector', url: `pmtiles://${root}/${encodeURI(region.tilesPath)}`, attribution: ATTRIBUTION, maxzoom: REGION_MAX_ZOOM };
    clone(name, 'region');
    layers.push(...serviceLayers(name, paint, lang));
    if (region.placesPath) {
      const overlay = `ov${region.id}`;
      sources[overlay] = { type: 'vector', url: `pmtiles://${root}/${encodeURI(region.placesPath)}`, attribution: ATTRIBUTION, maxzoom: OVERLAY_MAX_ZOOM };
      layers.push(...businessLayers(overlay, paint, lang));
    }
  }
  const names = hoodLayer(input.hoods ?? [], input.theme);
  if (names) {
    sources.hoods = names.source;
    layers.push(names.layer);
  }
  return { version: 8, sources, glyphs: `${baseRoot}/fonts-compact/{fontstack}/{range}.pbf`, sprite: `${baseRoot}/sprites/v4/${input.theme}`, layers };
}
