import { createHash } from 'node:crypto';
import { featureFilter, type FilterSpecification } from '@maplibre/maplibre-gl-style-spec';
import { language_script_pairs } from '@protomaps/basemaps';
import { buildStyle, type MapStyle } from '../../src/native/map/style';
import { createGeoTheme, ICON_GROUPS, type BrandMode } from '../../src/native/map/theme';
import type { MvtValue } from './mvt';

export type SourceKind = 'overview' | 'tiles' | 'places';
export type DrawFeature = { type: number; id?: number; properties: Record<string, MvtValue> };
export type DrawRule = { minzoom: number; maxzoom: number; zoomed: boolean; test: (zoom: number, feature: DrawFeature) => boolean };
export type UsageProfile = {
  props: Map<string, Set<string>>;
  named: Set<string>;
  labels: Set<string>;
  literals: Set<string>;
  rules: Map<string, DrawRule[]>;
  maxzoom: Partial<Record<SourceKind, number>>;
  usesIds: boolean;
  summary: ProfileSummary;
  digest: string;
};
export type ProfileSummary = { props: [string, string[]][]; rules: [string, string[]][]; named: string[]; labels: string[]; maxzoom: Partial<Record<SourceKind, number>>; runtime: string[]; nameLike: string; topZoom: number };

export const TOP_ZOOM = 25;
export const RUNTIME_PROPS = ['name', 'name:tr', 'kind', 'grp', 'g', 'lm'];
export const NAME_LIKE = /^name:[a-z]{2}$/;
const LEGACY_OPS = new Set(['==', '!=', '<', '<=', '>', '>=', 'in', '!in', 'has', '!has']);
const BRAND_MODES: BrandMode[] = ['category', 'badge', 'ladder', 'logo', 'hidden'];
const THEMES = ['light', 'dark'] as const;

export const styleLanguages = (): string[] => [...new Set([...language_script_pairs.map((pair: { lang: string }) => pair.lang.slice(0, 2)), 'xx'])].sort();

export function styleVariants(langs: string[] = styleLanguages()): MapStyle[] {
  const groups = Object.fromEntries(ICON_GROUPS.map((group) => [group, { visible: true, emphasis: 'normal' as const }]));
  const styles: MapStyle[] = [];
  for (const theme of THEMES) {
    for (const mode of BRAND_MODES) {
      const look = createGeoTheme({ map: { brands: { mode }, icons: { groups }, buildings3d: true } })[theme].map;
      for (const lang of langs) styles.push(buildStyle({ rootUrl: 'file:///packs', baseDir: 'base', regions: [{ id: '00', tilesPath: '00/tiles.pmtiles', placesPath: '00/places.pmtiles' }], theme, lang, look }));
    }
  }
  return styles;
}

export function sourceKind(name: string): SourceKind | null {
  if (name === 'base') return 'overview';
  if (/^r\d+$/.test(name)) return 'tiles';
  if (/^ov\d+$/.test(name)) return 'places';
  return null;
}

function collect(node: unknown, props: Set<string>, where: string, ids: { used: boolean }): void {
  if (Array.isArray(node)) {
    const [op, first] = node as unknown[];
    if (op === 'properties') throw new Error(`${where}: bütün özellikler okunuyor, budama güvenli değil`);
    if (op === 'id' || first === '$id') ids.used = true;
    if ((op === 'get' || op === 'has' || op === '!has') && node.length === 2) {
      if (typeof first !== 'string') throw new Error(`${where}: özellik adı ifadeyle seçiliyor, budama güvenli değil`);
      props.add(first);
    }
    if (typeof op === 'string' && LEGACY_OPS.has(op) && typeof first === 'string' && !first.startsWith('$')) props.add(first);
    for (const child of node) collect(child, props, where, ids);
  } else if (node && typeof node === 'object') {
    for (const child of Object.values(node)) collect(child, props, where, ids);
  } else if (typeof node === 'string') {
    for (const match of node.matchAll(/\{([^}]+)\}/g)) props.add(match[1] as string);
  }
}

function strings(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) for (const child of node) strings(child, out);
  else if (node && typeof node === 'object') for (const child of Object.values(node)) strings(child, out);
  else if (typeof node === 'string') out.add(node);
}

const sorted = (values: Iterable<string>): string[] => [...values].sort();

export function usageProfile(styles: MapStyle[]): UsageProfile {
  const props = new Map<string, Set<string>>();
  const named = new Set<string>();
  const labels = new Set<string>();
  const literals = new Set<string>();
  const rules = new Map<string, DrawRule[]>();
  const signatures = new Map<string, Set<string>>();
  const maxzoom: Partial<Record<SourceKind, number>> = {};
  const ids = { used: false };
  for (const style of styles) {
    for (const [name, source] of Object.entries(style.sources)) {
      const kind = sourceKind(name);
      if (kind && typeof source.maxzoom === 'number') maxzoom[kind] = Math.min(maxzoom[kind] ?? Infinity, source.maxzoom);
    }
    for (const layer of style.layers) {
      const kind = layer.source ? sourceKind(layer.source) : null;
      const sourceLayer = layer['source-layer'];
      if (!kind || typeof sourceLayer !== 'string') continue;
      const key = `${kind}/${sourceLayer}`;
      if (!props.has(key)) props.set(key, new Set());
      collect({ filter: layer.filter, layout: layer.layout, paint: layer.paint }, props.get(key) as Set<string>, layer.id, ids);
      const text = layer.layout?.['text-field'];
      if (text !== undefined) {
        const used = new Set<string>();
        collect(text, used, layer.id, ids);
        for (const prop of used) labels.add(prop);
        if ([...used].some((prop) => prop === 'name' || NAME_LIKE.test(prop))) named.add(key);
        strings(text, literals);
      }
      if (layer.layout?.visibility === 'none') continue;
      const minzoom = layer.minzoom ?? 0;
      const max = layer.maxzoom ?? Infinity;
      const signature = JSON.stringify([layer.filter ?? null, minzoom, layer.maxzoom ?? null]);
      if (!signatures.has(key)) signatures.set(key, new Set());
      const seen = signatures.get(key) as Set<string>;
      if (seen.has(signature)) continue;
      seen.add(signature);
      const compiled = featureFilter(layer.filter as FilterSpecification | undefined, `layers.${layer.id}.filter`);
      const blind = compiled.needGeometry || compiled.getGlobalStateRefs().size > 0;
      const test = blind ? () => true : (zoom: number, feature: DrawFeature) => compiled.filter({ zoom }, feature as never);
      if (!rules.has(key)) rules.set(key, []);
      (rules.get(key) as DrawRule[]).push({ minzoom, maxzoom: max, zoomed: blind || JSON.stringify(layer.filter ?? null).includes('"zoom"'), test });
    }
  }
  const summary: ProfileSummary = {
    props: sorted(props.keys()).map((key) => [key, sorted(props.get(key) as Set<string>)]),
    rules: sorted(signatures.keys()).map((key) => [key, sorted(signatures.get(key) as Set<string>)]),
    named: sorted(named),
    labels: sorted(labels),
    maxzoom,
    runtime: RUNTIME_PROPS,
    nameLike: NAME_LIKE.source,
    topZoom: TOP_ZOOM,
  };
  return { props, named, labels, literals, rules, maxzoom, usesIds: ids.used, summary, digest: createHash('sha256').update(JSON.stringify(summary)).digest('hex').slice(0, 16) };
}

export function keepsKey(profile: UsageProfile, kind: SourceKind, layer: string): ((key: string) => boolean) | null {
  const used = profile.props.get(`${kind}/${layer}`);
  if (!used) return null;
  const named = profile.named.has(`${kind}/${layer}`);
  return (key) => used.has(key) || RUNTIME_PROPS.includes(key) || (named && NAME_LIKE.test(key));
}

export function drawnAt(profile: UsageProfile, kind: SourceKind, layer: string, zoom: number, overzoomFrom: number): (feature: DrawFeature) => boolean {
  const zooms: number[] = [];
  for (let z = zoom; z <= (zoom >= overzoomFrom ? TOP_ZOOM : zoom); z++) zooms.push(z);
  const active = (profile.rules.get(`${kind}/${layer}`) ?? [])
    .map((rule) => ({ rule, zooms: zooms.filter((z) => Math.floor(rule.minzoom) <= z && z <= rule.maxzoom) }))
    .filter((entry) => entry.zooms.length > 0)
    .map(({ rule, zooms: at }) => ({ rule, zooms: rule.zoomed ? at : at.slice(0, 1) }));
  return (feature) => active.some(({ rule, zooms: at }) => at.some((z) => rule.test(z, feature)));
}
