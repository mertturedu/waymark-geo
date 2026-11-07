import chains from './chains.json';
import { withKind, withPlace } from './poi-glyphs';
import { DEFAULT_THEME, hiddenTokens, iconColor, ICON_GROUPS, inkColor, type IconGroup, type ResolvedMapLook } from './theme';
import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps';
import { MLT_SUFFIX } from '../../core/region/manifest';
import { upperTr } from '../../core/text/upper';
import { SHIELD_MAX_LENGTH, shieldImageExpression } from './shields';
import { bandOf, mapSlowdown, regionBusyness, type MapRoadKind, type TrafficBand } from '../../core/traffic/model';

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
  regions: { id: string; tilesPath: string; placesPath?: string; transitPath?: string }[];
  theme: 'light' | 'dark';
  lang: string;
  hide?: string[];
  hoods?: { name: string; lng: number; lat: number }[];
  look?: ResolvedMapLook;
  accent?: string;
  font?: MapFont;
  traffic?: { at: number };
};

export type MapFont = 'inter' | 'noto';

export const SEMI_TRANSPARENT_FROM_ZOOM = 9;
const BASE_MAX_ZOOM = 8;
const REGION_MAX_ZOOM = 15;
const OVERLAY_MAX_ZOOM = 16;
const ATTRIBUTION = '© OpenStreetMap contributors, Overture Maps';

const vectorSource = (root: string, path: string, maxzoom: number): Record<string, unknown> => ({
  type: 'vector',
  url: `pmtiles://${root}/${encodeURI(path)}`,
  attribution: ATTRIBUTION,
  maxzoom,
  ...(path.endsWith(MLT_SUFFIX) ? { encoding: 'mlt' } : {}),
});

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

const flavorLayers = (theme: 'light' | 'dark', lang: string, colors: Record<string, string> = {}): StyleLayer[] => {
  const flavor = { ...namedFlavor(theme), ...colors } as ReturnType<typeof namedFlavor>;
  const base = lang === 'ar' ? renamed(protomapsLayers('protomaps', flavor, { lang: 'de' }) as unknown as StyleLayer[], 'de', 'ar') : (protomapsLayers('protomaps', flavor, { lang }) as unknown as StyleLayer[]);
  return behindEnglish(base, lang);
};

const isSemiTransparent = (layer: StyleLayer): boolean => Object.keys(layer.paint ?? {}).some((key) => /opacity/.test(key));

export function semiTransparentLayerIds(theme: 'light' | 'dark'): string[] {
  return flavorLayers(theme, 'tr').filter(isSemiTransparent).map((layer) => layer.id);
}

const compactFonts = (layers: StyleLayer[]): StyleLayer[] =>
  JSON.parse(JSON.stringify(layers).replace(/Noto Sans Devanagari Regular v1/g, 'Noto Sans Regular').replace(/Noto Sans (Regular|Medium|Italic)/g, 'NotoSans$1')) as StyleLayer[];

const ROAD_LABELS: Record<string, { minzoom?: number; spacing: number }> = {
  roads_labels_minor: { minzoom: 14.5, spacing: 280 },
  roads_labels_major: { spacing: 320 },
};
export const ROAD_LETTER_SPACING = 0.1;

const tuneRoadLabels = (layers: StyleLayer[]): StyleLayer[] =>
  layers.map((layer) => {
    const tuning = ROAD_LABELS[layer.id];
    if (!tuning) return layer;
    return {
      ...layer,
      ...(tuning.minzoom === undefined ? {} : { minzoom: tuning.minzoom }),
      layout: { ...(layer.layout ?? {}), 'text-letter-spacing': ROAD_LETTER_SPACING, 'symbol-spacing': tuning.spacing, 'text-padding': 6 },
    };
  });

const FONT_STACKS: Record<MapFont, (weight: string) => string[]> = {
  noto: (weight) => [`NotoSans${weight}`],
  inter: (weight) => [`Inter${weight}`],
};

const NOTO_NAME = /^NotoSans(Regular|Medium|Italic)$/;

const swapStack = (value: unknown): unknown => {
  if (!Array.isArray(value)) return value;
  if (value.length > 0 && value.every((name) => typeof name === 'string' && NOTO_NAME.test(name))) return value.flatMap((name: string) => FONT_STACKS.inter(NOTO_NAME.exec(name)![1]!));
  return value.map(swapStack);
};

export const withFont = (layers: StyleLayer[], font: MapFont): StyleLayer[] => {
  if (font === 'noto') return layers;
  return layers.map((layer) => (layer.layout && 'text-font' in layer.layout ? { ...layer, layout: { ...layer.layout, 'text-font': swapStack(layer.layout['text-font']) } } : layer));
};

export const BUILDINGS_3D_FROM = 16;
export const BUILDING_DEFAULT_HEIGHT = 6;

const buildingsExtrusion = (sourceName: string, paint: Paint): StyleLayer => ({
  id: `buildings3d@${sourceName}`,
  type: 'fill-extrusion',
  source: sourceName,
  'source-layer': 'buildings',
  minzoom: BUILDINGS_3D_FROM,
  filter: ['in', 'kind', 'building', 'building_part'],
  paint: {
    'fill-extrusion-color': paint.look.base.buildings ?? '#E0E4EC',
    'fill-extrusion-opacity': 0.85,
    'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], BUILDINGS_3D_FROM, 0, BUILDINGS_3D_FROM + 0.6, ['coalesce', ['get', 'height'], BUILDING_DEFAULT_HEIGHT]],
    'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], BUILDINGS_3D_FROM, 0, BUILDINGS_3D_FROM + 0.6, ['coalesce', ['get', 'min_height'], 0]],
  },
});

const TERRAIN_KINDS: { key: string; kinds: string[] }[] = [
  { key: 'cemetery', kinds: ['cemetery'] },
  { key: 'sports', kinds: ['pitch', 'stadium', 'track', 'sports_centre'] },
];

const withTerrain = (layers: StyleLayer[], colors: Record<string, string>): StyleLayer[] =>
  layers.map((layer) => {
    if (layer.id !== 'landuse_park' || !Array.isArray(layer.filter) || !Array.isArray(layer.paint?.['fill-color'])) return layer;
    const [head, ...rest] = layer.paint['fill-color'] as unknown[];
    const branches = TERRAIN_KINDS.flatMap((terrain) => [['in', ['get', 'kind'], ['literal', terrain.kinds]], colors[terrain.key] ?? '#D6E3CC']);
    return {
      ...layer,
      filter: [...(layer.filter as unknown[]), ...TERRAIN_KINDS.flatMap((terrain) => terrain.kinds)],
      paint: { ...layer.paint, 'fill-color': [head, ...branches, ...rest] },
    };
  });

const withShields = (layers: StyleLayer[]): StyleLayer[] =>
  layers.map((layer) => {
    if (layer.id !== 'roads_shields') return layer;
    return {
      ...layer,
      filter: ['all', ['in', ['get', 'kind'], ['literal', ['highway', 'major_road']]], ['has', 'ref'], ['<=', ['length', ['get', 'ref']], SHIELD_MAX_LENGTH]],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 400,
        'icon-image': shieldImageExpression(),
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [2, 5, 2, 5],
        'icon-rotation-alignment': 'viewport',
        'text-rotation-alignment': 'viewport',
        'text-field': ['get', 'ref'],
        'text-font': ['NotoSansMedium'],
        'text-size': 9,
        'icon-allow-overlap': false,
      },
      paint: { 'text-color': '#FFFFFF' },
    };
  });

export const TRAFFIC_FROM = 8;
export const TRAFFIC_GLOW_FROM = 6;
export const TRAFFIC_COLOURS: Record<Exclude<TrafficBand, 'smooth'>, string> = { busy: '#F5B800', heavy: '#F26B21', jam: '#E0050F' };
const TRAFFIC_KINDS: MapRoadKind[] = ['highway', 'major_road', 'medium_road', 'minor_road'];
const TRAFFIC_WIDTH: Record<MapRoadKind, number[]> = { highway: [1.6, 3.4, 6.5, 12], major_road: [1.2, 2.8, 5.5, 10], medium_road: [0.6, 1.8, 3.8, 8], minor_road: [0, 0.7, 2.6, 6] };
const TRAFFIC_ZOOMS = [8, 12, 15, 18];
const GLOW_WIDTH: Record<MapRoadKind, number[]> = { highway: [4, 7, 11, 15], major_road: [0, 4, 8, 13], medium_road: [0, 0, 3, 8], minor_road: [0, 0, 0, 4] };
const GLOW_ZOOMS = [6, 9, 12, 15];

export function trafficLayers(sourceName: string, plate: string, at: number): StyleLayer[] {
  const busyness = regionBusyness(plate);
  const slow = TRAFFIC_KINDS.map((kind) => ({ kind, band: bandOf(mapSlowdown(kind, at, busyness)) })).filter((entry): entry is { kind: MapRoadKind; band: Exclude<TrafficBand, 'smooth'> } => entry.band !== 'smooth');
  if (slow.length === 0) return [];
  const colour = ['match', ['get', 'kind'], ...slow.flatMap((entry) => [entry.kind, TRAFFIC_COLOURS[entry.band]]), '#00000000'];
  const widths = (table: Record<MapRoadKind, number[]>, zooms: number[]): unknown[] => ['interpolate', ['linear'], ['zoom'], ...zooms.flatMap((zoom, step) => [zoom, ['match', ['get', 'kind'], ...slow.flatMap((entry) => [entry.kind, table[entry.kind][step] as number]), 0]])];
  const filter = ['in', ['get', 'kind'], ['literal', slow.map((entry) => entry.kind)]];
  const layout = { 'line-cap': 'round', 'line-join': 'round' };
  const glow: StyleLayer = { id: `traffic-glow@${sourceName}`, type: 'line', source: sourceName, 'source-layer': 'roads', minzoom: TRAFFIC_GLOW_FROM, maxzoom: 16, filter, layout, paint: { 'line-color': colour, 'line-width': widths(GLOW_WIDTH, GLOW_ZOOMS), 'line-blur': ['interpolate', ['linear'], ['zoom'], 6, 3, 12, 6, 15, 8], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 9, 0.32, 12, 0.22, 15, 0.1, 16, 0] } };
  const line: StyleLayer = { id: `traffic@${sourceName}`, type: 'line', source: sourceName, 'source-layer': 'roads', minzoom: TRAFFIC_FROM, filter, layout, paint: { 'line-color': colour, 'line-width': widths(TRAFFIC_WIDTH, TRAFFIC_ZOOMS), 'line-opacity': 0.9 } };
  return [glow, line];
}

export const TRANSIT_LINES_FROM = 11;
export const TRANSIT_STATIONS_FROM = 13;
const TRANSIT_COLOURS: Record<string, string> = { subway: '#D32F2F', light_rail: '#7B1FA2', tram: '#F57C00', train: '#546E7A', ferry: '#1E88E5' };

function transitLayers(sourceName: string, theme: 'light' | 'dark'): StyleLayer[] {
  const dark = theme === 'dark';
  const colour = ['coalesce', ['get', 'colour'], ['match', ['get', 'mode'], ...Object.entries(TRANSIT_COLOURS).flat(), '#546E7A']];
  const width = (near: number): unknown[] => ['interpolate', ['linear'], ['zoom'], TRANSIT_LINES_FROM, 1, 14, near * 0.6, 17, near];
  const base = { source: sourceName, 'source-layer': 'transit' };
  return [
    { ...base, id: `transit-casing@${sourceName}`, type: 'line', minzoom: TRANSIT_LINES_FROM, filter: ['all', ['==', ['get', 'kind'], 'line'], ['!=', ['get', 'mode'], 'ferry']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dark ? '#1A1A1D' : '#FFFFFF', 'line-width': width(6), 'line-opacity': 0.9 } },
    { ...base, id: `transit-lines@${sourceName}`, type: 'line', minzoom: TRANSIT_LINES_FROM, filter: ['all', ['==', ['get', 'kind'], 'line'], ['!=', ['get', 'mode'], 'ferry']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': colour, 'line-width': width(3.4) } },
    { ...base, id: `transit-ferry@${sourceName}`, type: 'line', minzoom: TRANSIT_LINES_FROM, filter: ['all', ['==', ['get', 'kind'], 'line'], ['==', ['get', 'mode'], 'ferry']], layout: { 'line-cap': 'butt' }, paint: { 'line-color': colour, 'line-width': width(2.4), 'line-dasharray': [2, 2] } },
    { ...base, id: `transit-stations@${sourceName}`, type: 'circle', minzoom: TRANSIT_STATIONS_FROM, filter: ['==', ['get', 'kind'], 'station'], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], TRANSIT_STATIONS_FROM, 3, 17, 6], 'circle-color': dark ? '#242428' : '#FFFFFF', 'circle-stroke-color': ['match', ['get', 'mode'], ...Object.entries(TRANSIT_COLOURS).flat(), '#546E7A'], 'circle-stroke-width': 2 } },
    { ...base, id: `transit-names@${sourceName}`, type: 'symbol', minzoom: TRANSIT_STATIONS_FROM + 1, filter: ['==', ['get', 'kind'], 'station'], layout: { 'text-field': ['get', 'name'], 'text-font': ['NotoSansMedium'], 'text-size': 10, 'text-anchor': 'top', 'text-offset': [0, 0.8], 'text-max-width': 7, 'text-optional': true }, paint: { 'text-color': dark ? '#C8C8D0' : '#4A4A4E', 'text-halo-color': dark ? '#242428' : '#FFFFFF', 'text-halo-width': 1.2 } },
  ] as StyleLayer[];
}

const HOOD_MIN_ZOOM = 12.5;
const NAME_MIN_ZOOM = 16;
export const HOOD_LETTER_SPACING = 0.12;

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

export const BRAND_IDS: string[] = chains.map((chain) => chain.id);

export const BRAND_ICONS = BRAND_IDS.map((id) => `geo-brand-${id}`);

export const BUSINESS_ICONS = ['geo-food', 'geo-shop', 'geo-landmark', 'geo-cargo'];

const SDF_GROUPS = ['health', 'pharmacy', 'safety', 'money', 'fuel', 'worship', 'lodging', 'market', 'public', 'food', 'shop', 'cargo', 'landmark'];
export const SDF_ICONS = [...SDF_GROUPS.map((group) => `geo-sdf-${group}`), 'geo-sdf-badge', 'geo-sdf-badge-rounded'];

const ICON_SIZE = { near: 0.36, far: 0.24 };
const BADGE_SIZE = { from: 0.4, to: 0.46 };
const LOGO_SIZE = { from: 0.22, to: 0.25 };
const LEGACY_LOGO_SIZE = { far: 0.38, near: 0.55 };
const EMPHASIS_SIZE = { strong: 1.1, normal: 1, quiet: 0.88 };
const EMPHASIS_ORDER = { strong: 0, normal: 100, quiet: 200 };
const QUIET_FROM_ZOOM = 16;
const ICON_PADDING = 4;
const BADGE = { size: 0.33, text: 11, offset: 1.1, padding: 2 };
const TIER_STEPS: Record<number, [number, number][]> = {
  1: [[15, 0]],
  2: [[15, 98], [16, 88], [16.5, 0]],
  3: [[15, 100], [16, 95], [16.5, 92], [17, 89], [17.5, 0]],
  4: [[16.5, 99], [17.2, 97], [17.7, 94], [18, 89], [18.5, 78], [19, 0]],
};
const SERVICE_CONFIDENCE = 96;

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

const tierGate = (confidence: unknown): unknown[] => [
  'any',
  ...Object.entries(TIER_STEPS).map(([tier, steps]) => ['all', ['==', ['var', 't'], Number(tier)], ['any', ...steps.map(([zoom, minimum]) => ['all', ['>=', ['zoom'], zoom], ['>=', confidence, minimum]])]]),
];

type BadgeSource = { shortNames?: boolean; id: string; source: string; sourceLayer: string; wrap: (body: unknown[]) => unknown[]; confidence: unknown; order: unknown; extra: unknown[] };

function badgeLayer(from: BadgeSource, paint: Paint, lang: string): StyleLayer {
  const { look, theme } = paint;
  const group = ['var', 'grp'];
  const color = (values: (group: IconGroup) => string): unknown[] => byGroup(group, values, values('public'));
  return {
    id: from.id,
    type: 'symbol',
    source: from.source,
    'source-layer': from.sourceLayer,
    filter: from.wrap(['all', ['has', 'name'], ['>', ['var', 't'], 0], tierGate(from.confidence), ...from.extra]),
    layout: {
      'icon-image': from.wrap(['concat', 'geo-badge-', ['var', 'k']]),
      'icon-size': from.wrap(['*', BADGE.size, byGroup(group, (g) => EMPHASIS_SIZE[look.icons.groups[g].emphasis] * look.icons.scale, look.icons.scale)]),
      'icon-allow-overlap': false,
      'icon-padding': BADGE.padding,
      'text-field': lang === 'tr' && from.shortNames ? ['coalesce', ['get', 'ns'], ...nameOf(lang).slice(1)] : nameOf(lang),
      'text-font': ['NotoSansMedium'],
      'text-size': BADGE.text,
      'text-anchor': 'left',
      'text-offset': [BADGE.offset, 0],
      'text-max-width': 7,
      'text-optional': false,
      'symbol-sort-key': from.wrap(['+', ['*', ['var', 't'], 100], from.order]),
    },
    paint: {
      'icon-color': from.wrap(color((g) => iconColor(look, g, theme, paint.accent))),
      'icon-halo-color': '#FFFFFF',
      'icon-halo-width': 1,
      'text-color': from.wrap(color((g) => inkColor(look, g, theme, paint.accent))),
      'text-halo-color': theme === 'dark' ? '#1B1B1D' : '#FFFFFF',
      'text-halo-width': 1.2,
    },
  };
}

function businessLayers(sourceName: string, paint: Paint, lang: string): StyleLayer[] {
  const { look, theme } = paint;
  const dark = theme === 'dark';
  const logos = look.brands.mode !== 'category' && look.brands.mode !== 'hidden';
  const poi = badgeLayer({ shortNames: true, id: `ov-icon@${sourceName}`, source: sourceName, sourceLayer: 'places', wrap: withPlace, confidence: ['get', 'c'], order: ['-', 100, ['get', 'c']], extra: logos ? [['!', ['has', 'b']]] : [] }, paint, lang);
  if (!logos) return [poi];
  const haloColor = dark ? '#1b1b1d' : '#ffffff';
  const textPaint = { 'text-color': dark ? '#b4b4bd' : '#55555e', 'text-halo-color': haloColor, 'text-halo-width': 1.2 };
  const nameLayout = { 'text-field': ['step', ['zoom'], '', NAME_MIN_ZOOM, nameOf(lang)], 'text-font': ['NotoSansRegular'], 'text-size': 10, 'text-anchor': 'top', 'text-offset': [0, 0.9], 'text-max-width': 7, 'text-optional': true };
  return [poi, ...brandLayers(sourceName, paint, nameLayout, textPaint)];
}

const serviceLayers = (sourceName: string, paint: Paint, lang: string): StyleLayer[] => [
  badgeLayer({ id: `service@${sourceName}`, source: sourceName, sourceLayer: 'pois', wrap: withKind, confidence: SERVICE_CONFIDENCE, order: ['get', 'min_zoom'], extra: [['>=', ['zoom'], ['get', 'min_zoom']]] }, paint, lang),
];

export type HoodCollection = { type: 'FeatureCollection'; features: { type: 'Feature'; properties: { name: string; label: string }; geometry: { type: 'Point'; coordinates: [number, number] } }[] };

export function hoodFeatures(hoods: NonNullable<StyleInput['hoods']>): HoodCollection {
  const seen = new Set<string>();
  const features = hoods
    .map((h) => ({ name: h.name.trim(), lng: h.lng, lat: h.lat }))
    .filter((h) => h.name !== '' && Number.isFinite(h.lng) && Number.isFinite(h.lat))
    .filter((h) => !seen.has(`${h.name}|${h.lng}|${h.lat}`) && seen.add(`${h.name}|${h.lng}|${h.lat}`))
    .map((h) => ({ type: 'Feature' as const, properties: { name: h.name, label: upperTr(h.name) }, geometry: { type: 'Point' as const, coordinates: [h.lng, h.lat] as [number, number] } }));
  return { type: 'FeatureCollection', features };
}

export function hoodLabelLayer(theme: 'light' | 'dark', font: MapFont = 'noto'): { id: string; type: 'symbol'; minzoom: number; layout: Record<string, unknown>; paint: Record<string, unknown> } {
  const dark = theme === 'dark';
  return {
    id: 'hood-labels',
    type: 'symbol',
    minzoom: HOOD_MIN_ZOOM,
    layout: { 'text-field': ['get', 'label'], 'text-font': FONT_STACKS[font]('Medium'), 'text-size': ['interpolate', ['linear'], ['zoom'], HOOD_MIN_ZOOM, 9, 16, 13], 'text-max-width': 7, 'text-letter-spacing': HOOD_LETTER_SPACING },
    paint: { 'text-color': dark ? '#b4b4bd' : '#7A7A7D', 'text-halo-color': dark ? '#1b1b1d' : '#F8F4EC', 'text-halo-width': 1.3 },
  };
}

function hoodLayer(hoods: NonNullable<StyleInput['hoods']>, theme: 'light' | 'dark', font: MapFont): { source: Record<string, unknown>; layer: StyleLayer } | null {
  const data = hoodFeatures(hoods);
  if (data.features.length === 0) return null;
  return { source: { type: 'geojson', data }, layer: { ...hoodLabelLayer(theme, font), source: 'hoods' } as StyleLayer };
}

const CLASS_HIDES: Record<string, string> = { brands: 'ov-brand@', places: 'ov-icon@', services: 'service@' };

function applyHide(layers: StyleLayer[], hide: string[]): StyleLayer[] {
  const classes = hide.filter((token) => token in CLASS_HIDES).map((token) => CLASS_HIDES[token]!);
  const groups = hide.filter((token) => token.startsWith('group:')).map((token) => token.slice(6));
  const chains = hide.filter((token) => token.startsWith('chain:')).map((token) => token.slice(6));
  const brands = hide.includes('brands');
  const landmarks = hide.includes('landmarks');
  const narrow = (layer: StyleLayer, extra: unknown[]): StyleLayer => ({ ...layer, filter: layer.filter ? ['all', layer.filter, ...extra] : ['all', ...extra] });
  return layers.map((layer) => {
    if (classes.some((prefix) => layer.id.startsWith(prefix))) return { ...layer, layout: { ...(layer.layout ?? {}), visibility: 'none' } };
    const place = layer.id.startsWith('ov-icon@');
    const service = layer.id.startsWith('service@');
    const brand = layer.id.startsWith('ov-brand@');
    const extra: unknown[] = [];
    if (groups.length > 0 && (place || service)) extra.push(['!', ['in', (service ? withKind : withPlace)(['var', 'grp']), ['literal', groups]]]);
    if (groups.length > 0 && brand) extra.push(['!', ['in', ['get', 'g'], ['literal', groups]]]);
    if (place && brands) extra.push(['!', ['has', 'b']]);
    if (place && landmarks) extra.push(['!', ['has', 'lm']]);
    if (chains.length > 0 && (place || brand)) extra.push(['!', ['in', ['get', 'b'], ['literal', chains]]]);
    return extra.length > 0 ? narrow(layer, extra) : layer;
  });
}

export function buildStyle(input: StyleInput): MapStyle {
  const built = assembleStyle(input);
  const style = input.font && input.font !== 'noto' ? { ...built, layers: withFont(built.layers, input.font) } : built;
  const hide = [...new Set([...(input.hide ?? []), ...hiddenTokens(input.look ?? DEFAULT_THEME[input.theme].map)])];
  return hide.length > 0 ? { ...style, layers: applyHide(style.layers, hide) } : style;
}

function assembleStyle(input: StyleInput): MapStyle {
  const root = fileUrl(input.rootUrl).replace(/\/$/, '');
  const lang = cleanLang(input.lang);
  const paint: Paint = { look: input.look ?? DEFAULT_THEME[input.theme].map, theme: input.theme, accent: input.accent ?? DEFAULT_THEME[input.theme].colors.accent };
  const flavored = withShields(withTerrain(tuneRoadLabels(compactFonts(flavorLayers(input.theme, lang, paint.look.base))), paint.look.base));
  const background = flavored.filter((layer) => layer.type === 'background');
  const drawn = flavored.filter((layer) => layer.type !== 'background' && layer['source-layer'] !== 'pois');
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
    sources[name] = vectorSource(root, region.tilesPath, REGION_MAX_ZOOM);
    const before = layers.length;
    clone(name, 'region');
    if (input.traffic) {
      const drawnTraffic = trafficLayers(name, region.id, input.traffic.at);
      const symbol = layers.findIndex((layer, index) => index >= before && layer.type === 'symbol');
      layers.splice(symbol < 0 ? layers.length : symbol, 0, ...drawnTraffic);
    }
    if (paint.look.buildings3d) layers.push(buildingsExtrusion(name, paint));
    layers.push(...serviceLayers(name, paint, lang));
    if (region.transitPath) {
      const transit = `tr${region.id}`;
      sources[transit] = vectorSource(root, region.transitPath, OVERLAY_MAX_ZOOM);
      layers.push(...transitLayers(transit, input.theme));
    }
    if (region.placesPath) {
      const overlay = `ov${region.id}`;
      sources[overlay] = vectorSource(root, region.placesPath, OVERLAY_MAX_ZOOM);
      layers.push(...businessLayers(overlay, paint, lang));
    }
  }
  const names = hoodLayer(input.hoods ?? [], input.theme, 'noto');
  if (names) {
    sources.hoods = names.source;
    layers.push(names.layer);
  }
  return { version: 8, sources, glyphs: `${baseRoot}/fonts-compact/{fontstack}/{range}.pbf`, sprite: `${baseRoot}/sprites/v4/${input.theme}`, layers };
}
