import type { LngLat } from '../geo/cells';
import { distanceM, ringAround } from '../geo/distance';
import type { ClockPort } from '../packs/ports';
import type { PackStore, SqlDb } from '../ports';
import type { Borders } from '../region/borders';
import { findDistrict, findProvince, provinceName } from '../text/admin';
import { parseAddress } from '../text/parse';
import { sameStreet, streetKey } from '../text/street';
import type { Lang, ParsedAddress } from '../text/types';
import { openBuildings } from './buildings';
import { AUTOCOMPLETE_TEXT, autocompleteInRegion } from './autocomplete';
import { mergeDirectory } from './directory';
import { formatLabel } from './label';
import { pickName } from './localize';
import { nameScore } from './names';
import { coverageLevel, shortHoodName, type Coverage, type HoodLabel } from './coverage';
import { openRegion, readHoodRows, type HoodRow, type Region } from './pack';
import { boxAround, clampLimit, clampRadius, isNearbyGroup, NEARBY_GROUPS, NEARBY_READ_CAP, type NearbyGroup } from './nearby';
import { placesInRegion, poiScored } from './places';
import { firstContaining, reversePoint } from './reverse';
import { resolveInRegion, type RegionContext, type Scored } from './resolve';
import type { PointLayer, Place, ResolveResult, SearchOptions, StructuredQuery } from './types';

export type NearbyOptions = { point: LngLat; group: NearbyGroup; limit?: number; radiusM?: number; language?: Lang };
export type NearbyHit = { place: Place; distanceM: number };

export type Search = {
  resolve(input: string | StructuredQuery, options?: SearchOptions): Promise<ResolveResult>;
  autocomplete(text: string, options?: SearchOptions): Promise<Place[]>;
  reverse(point: LngLat, options?: { language?: Lang }): Promise<Place | null>;
  nearby(options: NearbyOptions): Promise<NearbyHit[]>;
  invalidate(plate?: string): void;
  hoods(plate?: string, language?: Lang): Promise<HoodLabel[]>;
  coverage(point: LngLat): Promise<Coverage | null>;
};

const DEFAULT_LIMIT = 5;
const AUTOCOMPLETE_LIMIT = 8;
const REVERSE_RING_M = 150;
const MAX_LIMIT = 50;
const BORDER_RING_M = 2000;
const MAX_REGIONS = 12;
const AMBIGUOUS_GAP = 0.05;
const SAME_SPOT_M = 30;
const MAX_TEXT = 500;
const SUGGEST_NAME_MIN = 0.7;
const SURE = 0.9;
const SUGGEST_PRECISION: ReadonlySet<string> = new Set(['address', 'interpolated', 'street']);

type Opened = { context: RegionContext; db: SqlDb; extra?: RegionContext };

function structuredText(q: StructuredQuery): string {
  return [q.poiName, q.neighbourhood ? `${q.neighbourhood} mahallesi` : undefined, q.street, q.houseNumber ? `no ${q.houseNumber}` : undefined, q.building, q.door ? `daire ${q.door}` : undefined, q.district, q.province]
    .filter((p): p is string => !!p)
    .join(' ');
}

function limitOf(value: number | undefined, fallback: number, floor: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(floor, Math.floor(value)));
}

function cleanOptions(options: unknown): SearchOptions {
  if (!options || typeof options !== 'object') return {};
  const given = options as SearchOptions;
  const hints = given.hints && typeof given.hints === 'object' ? given.hints : undefined;
  return { ...given, hints: hints && { city: typeof hints.city === 'string' ? hints.city : undefined, district: typeof hints.district === 'string' ? hints.district : undefined } };
}

const isPoint = (point: unknown): point is LngLat => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]);

const sure = (items: Scored[]): boolean => items.some((s) => (s.place.precision === 'address' || s.place.precision === 'poi') && s.place.confidence >= SURE);

function didYouMean(typed: string, items: Scored[]): { suggestion: Place } | Record<string, never> {
  if (typed === '') return {};
  const named = items.filter((s) => !!s.place.components.street);
  if (named.some((s) => sameStreet(typed, s.place.components.street as string))) return {};
  const asked = streetKey(typed);
  let best: { place: Place; name: number } | null = null;
  for (const s of named) {
    if (!SUGGEST_PRECISION.has(s.place.precision)) continue;
    const name = nameScore(asked, streetKey(s.place.components.street as string)).score;
    if (name >= SUGGEST_NAME_MIN && (best === null || name > best.name || (name === best.name && s.place.confidence > best.place.confidence))) best = { place: s.place, name };
  }
  return best ? { suggestion: best.place } : {};
}

function rank(items: Scored[], near?: LngLat): Scored[] {
  const away = (s: Scored): number => (near && Number.isFinite(near[0]) && Number.isFinite(near[1]) ? distanceM(near, s.place.coordinate) : 0);
  const sorted = [...items].sort((a, b) => b.score - a.score || away(a) - away(b) || (a.place.id < b.place.id ? -1 : a.place.id > b.place.id ? 1 : 0));
  const seen = new Set<string>();
  return sorted.filter((s) => (seen.has(s.place.id) ? false : (seen.add(s.place.id), true)));
}

export const MAX_OPEN_REGIONS = 4;
export const SEARCH_IDLE_MS = 120_000;

export function createSearch(config: { store: PackStore; borders: Borders; layers?: PointLayer[]; clock?: ClockPort; maxOpen?: number; idleMs?: number }): Search {
  const layers = config.layers ?? [];
  const opened = new Map<string, Promise<Opened | null>>();
  const used = new Map<string, number>();
  const order = new Map<string, number>();
  let tick = 0;
  const hoodRows = new Map<string, HoodRow[]>();
  const maxOpen = Math.max(1, config.maxOpen ?? MAX_OPEN_REGIONS);
  const idleMs = config.idleMs ?? SEARCH_IDLE_MS;

  const evict = (plate: string): void => {
    opened.delete(plate);
    used.delete(plate);
    order.delete(plate);
    config.store.release?.(plate);
  };

  const sweep = (keep: string): void => {
    const clock = config.clock;
    if (!clock) return;
    const now = clock.now();
    for (const plate of [...opened.keys()]) if (plate !== keep && now - (used.get(plate) ?? now) >= idleMs) evict(plate);
  };

  const trim = (keep: string): void => {
    while (opened.size > maxOpen) {
      let oldest: string | null = null;
      for (const plate of opened.keys()) if (plate !== keep && (oldest === null || (order.get(plate) ?? 0) < (order.get(oldest) ?? 0))) oldest = plate;
      if (oldest === null) return;
      evict(oldest);
    }
  };

  const load = async (plate: string): Promise<Opened | null> => {
    const db = await config.store.open(plate);
    if (!db) return null;
    const region = await openRegion(db);
    const official = new Map(region.districts.map((d) => [d.id, findDistrict(d.name, plate)[0]?.id ?? null]));
    let snap: RegionContext['snap'];
    try {
      const part = config.store.openPart ? await config.store.openPart(plate, 'buildings') : null;
      snap = part ? await openBuildings(part, (cells) => region.addressesInCells(cells)) : undefined;
    } catch {
      snap = undefined;
    }
    const context: RegionContext = { region, provinceName: provinceName(plate) ?? plate, official, layers, language: 'tr', findDistrictId: (name) => findDistrict(name, plate)[0]?.id ?? null, snap };
    let extra: RegionContext | undefined;
    try {
      const listing = config.store.openPart ? await config.store.openPart(plate, 'directory') : null;
      if (listing) {
        const other = await openRegion(listing);
        extra = { ...context, region: other, official: new Map(other.districts.map((d) => [d.id, findDistrict(d.name, plate)[0]?.id ?? null])), layers: [], snap: undefined };
      }
    } catch {
      extra = undefined;
    }
    return { context, db, extra };
  };

  const open = async (plate: string): Promise<Opened | null> => {
    let entry = opened.get(plate);
    if (!entry) {
      entry = load(plate);
      opened.set(plate, entry);
    }
    let value: Opened | null = null;
    try {
      value = await entry;
    } catch {
      value = null;
    }
    if (value === null && opened.get(plate) === entry) opened.delete(plate);
    else if (value !== null) {
      order.set(plate, ++tick);
      sweep(plate);
      if (config.clock) used.set(plate, config.clock.now());
      trim(plate);
    }
    return value;
  };

  async function pickRegions(parsed: ParsedAddress, options: SearchOptions): Promise<{ plates: string[]; missing: string[]; needed: string[] }> {
    const installed = await config.store.installed();
    const explicit = parsed.province && !parsed.province.ambiguous ? parsed.province.id : options.hints?.city ? (findProvince(options.hints.city)?.id ?? null) : null;
    if (explicit) return { plates: installed.includes(explicit) ? [explicit] : [], missing: [], needed: [explicit] };
    if (options.near) {
      const wanted = new Set<string>();
      const here = config.borders.provinceAt(options.near[0], options.near[1]);
      if (here) wanted.add(here);
      for (const p of ringAround(options.near, BORDER_RING_M)) {
        const plate = config.borders.provinceAt(p[0], p[1]);
        if (plate) wanted.add(plate);
      }
      const needed = [...wanted].sort();
      const plates = needed.filter((p) => installed.includes(p));
      if (plates.length > 0 || needed.length > 0) return { plates, missing: needed.filter((p) => !installed.includes(p)), needed };
    }
    return { plates: installed.slice(0, MAX_REGIONS), missing: installed.slice(MAX_REGIONS), needed: [] };
  }

  async function resolve(input: string | StructuredQuery, given: SearchOptions = {}): Promise<ResolveResult> {
    const options = cleanOptions(given);
    const text = (typeof input === 'string' ? input : input && typeof input === 'object' ? structuredText(input) : '').slice(0, MAX_TEXT);
    const parsed = parseAddress(text);
    const language: Lang = options.language ?? 'tr';
    const limit = limitOf(options.limit, DEFAULT_LIMIT, 1);
    const { plates, missing, needed } = await pickRegions(parsed, options);
    if (plates.length === 0 && needed.length > 0) return { status: 'region_missing', regions: needed };
    const scored: Scored[] = [];
    const failed: string[] = [];
    for (const plate of plates) {
      const entry = await open(plate);
      if (!entry) {
        failed.push(plate);
        continue;
      }
      const ctx = { ...entry.context, language, hints: options.hints };
      const own: Scored[] = await resolveInRegion(ctx, parsed);
      const withPlaces = !parsed.street || parsed.street.kind === null;
      if (withPlaces) own.push(...(await placesInRegion(ctx, parsed)));
      if (entry.extra && !sure(own)) {
        const other = { ...entry.extra, language, hints: options.hints };
        const listed: Scored[] = await resolveInRegion(other, parsed);
        if (withPlaces && !parsed.houseNumber) listed.push(...(await placesInRegion(other, parsed)));
        scored.push(...mergeDirectory(plate, own, listed));
      } else scored.push(...own);
    }
    const onlyProvince = parsed.province && !parsed.province.ambiguous && parsed.leftover.length === 0 && !parsed.district && !parsed.neighbourhood && !parsed.street && !parsed.houseNumber;
    if (onlyProvince && parsed.province) {
      const box = config.borders.provinceBounds(parsed.province.id);
      if (box) {
        const name = provinceName(parsed.province.id) ?? parsed.province.name;
        scored.push({
          score: 0.98,
          area: 'province',
          place: { id: `${parsed.province.id}:p:0`, label: formatLabel({ province: name }, language), components: { province: name }, coordinate: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], precision: 'province', approximate: true, source: 'derived', confidence: 0.98, region: parsed.province.id },
        });
      }
    }
    const unique = rank(scored, options.near);
    const candidates = unique.slice(0, limit).map((s) => s.place);
    const unavailable = [...new Set([...missing, ...failed])].sort();
    const extra = unavailable.length > 0 ? { missing: unavailable } : {};
    const top = unique[0];
    if (!top) return { status: 'not_found', candidates: [], ...extra };
    const suggestion = didYouMean(parsed.street?.text ?? '', unique);
    const rival = unique.some((s) => s !== top && top.score - s.score < AMBIGUOUS_GAP && (s.area !== top.area || distanceM(s.place.coordinate, top.place.coordinate) > SAME_SPOT_M));
    if (rival) return { status: 'ambiguous', candidates, ...extra, ...suggestion };
    return { status: 'resolved', best: top.place, candidates, ...extra, ...suggestion };
  }

  return {
    resolve,
    invalidate(plate) {
      if (plate === undefined) {
        opened.clear();
        used.clear();
        order.clear();
        hoodRows.clear();
      } else {
        opened.delete(plate);
        used.delete(plate);
        order.delete(plate);
        hoodRows.delete(plate);
      }
    },
    async hoods(plate, language = 'tr') {
      const installed = await config.store.installed();
      const labels: HoodLabel[] = [];
      for (const id of plate === undefined ? installed : installed.filter((p) => p === plate)) {
        let rows = hoodRows.get(id);
        if (!rows) {
          const peeked = config.store.peek && !opened.has(id) ? await config.store.peek(id, readHoodRows) : null;
          if (peeked) rows = peeked;
          else {
            const entry = await open(id);
            if (!entry) continue;
            rows = entry.context.region.hoods.filter((hood) => hood.center).map((hood) => ({ names: hood.names, name: hood.name, center: hood.center as [number, number] }));
          }
          hoodRows.set(id, rows);
        }
        for (const hood of rows) labels.push({ region: id, name: shortHoodName(pickName(hood.names, language, hood.name)), lng: hood.center[0], lat: hood.center[1] });
      }
      return labels.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.lng - b.lng));
    },
    async coverage(point) {
      if (!isPoint(point)) return null;
      const plate = config.borders.provinceAt(point[0], point[1]);
      if (!plate || !(await config.store.installed()).includes(plate)) return null;
      const entry = await open(plate);
      if (!entry) return null;
      const region = entry.context.region;
      const id = firstContaining(await region.districtPolygons(), point);
      const district = region.districts.find((d) => d.id === id);
      if (id === null || !district) return null;
      const counts = (await region.districtCoverage()).get(id) ?? { streets: 0, addresses: 0 };
      const listed = entry.extra ? ((await entry.extra.region.districtCoverage()).get(id) ?? { streets: 0, addresses: 0 }) : { streets: 0, addresses: 0 };
      const streets = Math.max(counts.streets, listed.streets);
      const addresses = counts.addresses + listed.addresses;
      return { region: plate, district: district.name, streets, addresses, level: coverageLevel(streets, addresses) };
    },
    async autocomplete(text, given = {}) {
      const options = cleanOptions(given);
      const limit = limitOf(options.limit, AUTOCOMPLETE_LIMIT, 0);
      if (limit === 0) return [];
      const parsed = parseAddress((typeof text === 'string' ? text : '').slice(-AUTOCOMPLETE_TEXT));
      const language: Lang = options.language ?? 'tr';
      const { plates } = await pickRegions(parsed, options);
      const scored: Scored[] = [];
      for (const plate of plates) {
        const entry = await open(plate);
        if (!entry) continue;
        const own = await autocompleteInRegion({ ...entry.context, language, hints: options.hints }, parsed);
        scored.push(...(entry.extra && own.length < limit ? mergeDirectory(plate, own, await autocompleteInRegion({ ...entry.extra, language, hints: options.hints }, parsed)) : own));
      }
      return rank(scored, options.near).slice(0, limit).map((s) => s.place);
    },
    async nearby(given) {
      const point = given?.point;
      if (!isPoint(point) || !isNearbyGroup(given.group)) return [];
      const radius = clampRadius(given.radiusM);
      const limit = clampLimit(given.limit);
      const box = boxAround(point, radius);
      const wanted = new Set<string>();
      for (const corner of [point, [box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]] as LngLat[]) {
        const plate = config.borders.provinceAt(corner[0], corner[1]);
        if (plate) wanted.add(plate);
      }
      const installed = new Set(await config.store.installed());
      const hits: NearbyHit[] = [];
      for (const plate of [...wanted].sort()) {
        const entry = installed.has(plate) ? await open(plate) : null;
        if (!entry) continue;
        const ctx = { ...entry.context, language: given.language ?? 'tr' };
        for (const poi of await entry.context.region.poisInBox(NEARBY_GROUPS[given.group], box, NEARBY_READ_CAP)) {
          const gap = distanceM(point, [poi.lng, poi.lat]);
          if (gap <= radius) hits.push({ place: poiScored(ctx, poi, 1).place, distanceM: Math.round(gap) });
        }
      }
      return hits.sort((a, b) => a.distanceM - b.distanceM || (a.place.id < b.place.id ? -1 : 1)).slice(0, limit);
    },
    async reverse(point, given = {}) {
      if (!isPoint(point)) return null;
      const options = given && typeof given === 'object' ? given : {};
      const wanted = new Set<string>();
      for (const p of [point, ...ringAround(point, REVERSE_RING_M)]) {
        const plate = config.borders.provinceAt(p[0], p[1]);
        if (plate) wanted.add(plate);
      }
      const installed = new Set(await config.store.installed());
      const regions: Region[] = [];
      for (const plate of [...wanted].sort()) {
        const entry = installed.has(plate) ? await open(plate) : null;
        if (entry) regions.push(entry.context.region);
      }
      return reversePoint(regions, config.borders, point, options.language);
    },
  };
}

export type { Region };
