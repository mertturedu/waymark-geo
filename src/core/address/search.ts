import type { LngLat } from '../geo/cells';
import type { Arrival } from '../route/arrival';
import { arrivalOf, chooseEntrance, type EntranceFinder } from './arrival';
import { shapeOf, type PlaceShape } from './geometry';
import type { Bbox } from '../geo/simplify';
import { distanceM, ringAround } from '../geo/distance';
import type { ClockPort } from '../packs/ports';
import type { PackStore, SqlDb } from '../ports';
import type { Borders } from '../region/borders';
import { findDistrict, findProvince, provinceName } from '../text/admin';
import { adminLookup, type AdminQuery, type AdminResult } from './admin';
import { nameKey } from '../text/fold';
import { parseAddress } from '../text/parse';
import type { Neighbourhoods, PostcodeCheck } from './neighbourhoods';
import { sameStreet, streetKey } from '../text/street';
import type { Lang, ParsedAddress } from '../text/types';
import { formerHoodPlates } from './aliases';
import { openBuildings } from './buildings';
import { openBuildings2, type Buildings2, type BuildingInfo } from './buildings2';
import { AUTOCOMPLETE_TEXT, autocompleteInRegion } from './autocomplete';
import { mergeDirectory } from './directory';
import { formatLabel } from './label';
import { pickName } from './localize';
import { editDistance, nameScore } from './names';
import { analyse, type Suggestions, type Validation } from './validate';
import { completionOf, recentsAsPlaces, sessionRegion, unitHintFor, type TypeSession } from './typeahead';
import { coverageLevel, shortHoodName, type Coverage, type HoodLabel } from './coverage';
import { openRegion, readHoodRows, type HoodRow, type Region } from './pack';
import { boxAround, clampLimit, clampRadius, isNearbyGroup, NEARBY_GROUPS, NEARBY_READ_CAP, type NearbyGroup } from './nearby';
import { buildingsByName } from './building-names';
import { placesInRegion, placesOnWrittenStreet, poiScored } from './places';
import { firstContaining, reversePoint } from './reverse';
import { components, resolveInRegion, scored, streetPoint, type RegionContext, type Scored } from './resolve';
import { besideOf, behindOf, cornerOf, CORNER_REACH_M, LANDMARK_LINK_M, oppositeOf, relationOf, RELATION_LABEL, type RelationAsk, type Target } from './landmark';
import { composeKey, layerKeyOf } from '../learn/key';
import { learnedStreet, learnedStreetsInProvince, needsLearnedStreet, needsProvinceStreet } from './learned-street';
import { layoutKey } from '../learned/layout';
import type { BuildingLayout } from '../learned/types';
import { blockKey, doorNumber, resolveBlock, resolveUnit, SITE_RADIUS_M } from './unit';
import type { PointLayer, Place, PlaceGeometry, ResolveResult, SearchOptions, StructuredQuery } from './types';

export type NearbyOptions = { point: LngLat; group: NearbyGroup; limit?: number; radiusM?: number; language?: Lang };
export type NearbyHit = { place: Place; distanceM: number };

export type AutocompleteOptions = SearchOptions & { session?: TypeSession; deep?: boolean; budgetMs?: number; recent?: Place[]; saved?: Place[] };

export type ReverseOptions = { language?: Lang; heading?: number; accuracyM?: number; hide?: number[] };

export type Search = {
  resolve(input: string | StructuredQuery, options?: SearchOptions): Promise<ResolveResult>;
  lookup(id: string): Promise<Place | null>;
  admin(query: AdminQuery): Promise<AdminResult | null>;
  validate(input: string, options?: SearchOptions): Promise<Validation>;
  autocomplete(text: string, options?: AutocompleteOptions): Promise<Place[]>;
  reverse(point: LngLat, options?: ReverseOptions): Promise<Place | null>;
  nearby(options: NearbyOptions): Promise<NearbyHit[]>;
  invalidate(plate?: string): void;
  hoods(plate?: string, language?: Lang): Promise<HoodLabel[]>;
  coverage(point: LngLat): Promise<Coverage | null>;
  arrival(place: Place): Promise<Arrival>;
  warm(plate: string): Promise<boolean>;
  geometry(place: Place): Promise<{ geometry: PlaceGeometry | null; bbox: Bbox | null } | null>;
};

const DEFAULT_LIMIT = 5;
const AUTOCOMPLETE_LIMIT = 8;
const REVERSE_RING_M = 150;
const MAX_LIMIT = 50;
const BORDER_RING_M = 2000;
const MAX_REGIONS = 12;
const UNIT_TOLERANCE_M = 10;
const SHAPE_MEMO = 64;
const SHAPE_PLACES = 5;
const UNIT_NEIGHBOURS = 200;
const UNIT_NEAR_M = 70;
const LANDMARK_CANDIDATES = 5;
const SAVED_BOOST = 1.15;
const RECENT_BOOST = 1.1;
const SAME_DISTRICT_BOOST = 1.03;
const STORED_SCORE = 0.97;
const UNIT_HINTS = 3;
const TYPE_NEAR_FREE_M = 2000;
const TYPE_NEAR_SPAN_M = 200_000;
const TYPE_NEAR_DROP = 0.12;
const VALIDATE_LIMIT = 8;
const SUGGEST_MIN = 5;
const SUGGEST_SHORT = 7;
const LANDMARK_STRETCH_M = 150;
const RELATIVE_CONFIDENCE = 0.7;
const AMBIGUOUS_GAP = 0.05;
const SAME_SPOT_M = 30;
const MAX_TEXT = 500;
const SUGGEST_NAME_MIN = 0.7;
const SURE = 0.9;
const SUGGEST_PRECISION: ReadonlySet<string> = new Set(['address', 'interpolated', 'street']);

type Opened = { context: RegionContext; db: SqlDb; extra?: RegionContext };

export function structuredText(q: StructuredQuery): string {
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

const ALTERNATIVE_FACTOR = 0.99;

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

function withNote(result: ResolveResult, note: string): ResolveResult {
  if (result.status === 'region_missing') return result;
  const mark = (p: Place): Place => ({ ...p, notes: [...(p.notes ?? []), note] });
  return result.status === 'resolved' ? { ...result, best: mark(result.best), candidates: result.candidates.map(mark) } : { ...result, candidates: result.candidates.map(mark) };
}

function placesOf(value: unknown): Place[] {
  return Array.isArray(value) ? value.filter((p): p is Place => !!p && typeof p === 'object' && typeof (p as Place).id === 'string' && typeof (p as Place).label === 'string' && isPoint((p as Place).coordinate) && typeof (p as Place).components === 'object') : [];
}

const withCompletion = (places: Place[]): Place[] =>
  places.map((p) => {
    const completion = completionOf(p);
    return completion === null ? p : { ...p, completion };
  });

function nearer(items: Scored[], near?: LngLat): Scored[] {
  if (!near || !isPoint(near)) return items;
  return items.map((s) => {
    const factor = 1 - Math.min(TYPE_NEAR_DROP, (Math.max(0, distanceM(near, s.place.coordinate) - TYPE_NEAR_FREE_M) / TYPE_NEAR_SPAN_M) * TYPE_NEAR_DROP);
    return factor === 1 ? s : { ...s, score: s.score * factor };
  });
}

const PLACE_STRONG = 0.8;
const AREA_ONLY_FACTOR = 0.8;
const NEAR_FREE_M = 5000;
const NEAR_SPAN_M = 300_000;
const NEAR_MAX_DROP = 0.15;

function favourPlaces(items: Scored[], parsed: ParsedAddress, near?: LngLat): Scored[] {
  const area = new Set([parsed.province?.name, parsed.district?.name].flatMap((n) => (n ? nameKey(n).split(' ') : [])));
  const own = (s: Scored): boolean => nameKey(s.place.components.poiName ?? '').split(' ').some((w) => w !== '' && !area.has(w));
  const named = !parsed.street?.kind && parsed.houseNumber === null && items.some((s) => s.place.precision === 'poi' && s.score >= PLACE_STRONG && own(s));
  const here = near && Number.isFinite(near[0]) && Number.isFinite(near[1]) ? near : null;
  if (!named && !here) return items;
  return items.map((s) => {
    let score = s.score;
    if (named && s.place.precision !== 'poi' && s.place.precision !== 'address') score *= AREA_ONLY_FACTOR;
    if (here && s.place.precision === 'poi') score *= 1 - Math.min(NEAR_MAX_DROP, (Math.max(0, distanceM(here, s.place.coordinate) - NEAR_FREE_M) / NEAR_SPAN_M) * NEAR_MAX_DROP);
    return score === s.score ? s : { ...s, score };
  });
}

export const MAX_OPEN_REGIONS = 4;
export const SEARCH_IDLE_MS = 120_000;

export function createSearch(config: { store: PackStore; borders: Borders; layers?: PointLayer[]; neighbourhoods?: Neighbourhoods; clock?: ClockPort; maxOpen?: number; idleMs?: number }): Search {
  const parse = (text: string): ParsedAddress => (config.neighbourhoods ? config.neighbourhoods.fillArea(parseAddress(text)) : parseAddress(text));
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
    let buildings2: RegionContext['buildings2'];
    try {
      const part2 = config.store.openPart ? await config.store.openPart(plate, 'buildings2') : null;
      buildings2 = part2 ? await openBuildings2(part2) : undefined;
    } catch {
      buildings2 = undefined;
    }
    const context: RegionContext = { region, provinceName: provinceName(plate) ?? plate, official, layers, language: 'tr', findDistrictId: (name) => findDistrict(name, plate)[0]?.id ?? null, snap, buildings2 };
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

  async function hoodRowsOf(id: string): Promise<HoodRow[] | null> {
    let rows = hoodRows.get(id);
    if (rows) return rows;
    const peeked = config.store.peek && !opened.has(id) ? await config.store.peek(id, readHoodRows) : null;
    if (peeked) rows = peeked;
    else {
      const entry = await open(id);
      if (!entry) return null;
      rows = entry.context.region.hoods.filter((hood) => hood.center).map((hood) => ({ names: hood.names, name: hood.name, center: hood.center as [number, number] }));
    }
    hoodRows.set(id, rows);
    return rows;
  }

  async function platesWithHood(text: string, installed: string[]): Promise<string[]> {
    const key = nameKey(text);
    const compact = key.replace(/ /g, '');
    const found: string[] = [];
    for (const id of installed) {
      const rows = await hoodRowsOf(id);
      if (!rows) continue;
      if (rows.some((hood) => { const own = nameKey(hood.name); return own === key || own.replace(/ /g, '') === compact; }) || formerHoodPlates(key).includes(id)) found.push(id);
    }
    return found;
  }

  async function pickRegions(parsed: ParsedAddress, options: SearchOptions): Promise<{ plates: string[]; missing: string[]; needed: string[] }> {
    const installed = await config.store.installed();
    const explicit = parsed.province && !parsed.province.ambiguous ? parsed.province.id : options.hints?.city ? (findProvince(options.hints.city)?.id ?? null) : null;
    const written = explicit !== null && parsed.province !== null && (` ${nameKey(parsed.input)} `).includes(` ${nameKey(parsed.province.name)} `);
    if (explicit && !(options.near && !written && !options.hints?.city)) return { plates: installed.includes(explicit) ? [explicit] : [], missing: [], needed: [explicit] };
    const coded = parsed.postcode ? parsed.postcode.slice(0, 2) : null;
    if (coded && installed.includes(coded) && !options.near) return { plates: [coded], missing: [], needed: [] };
    if (options.near) {
      const wanted = new Set<string>();
      const here = config.borders.provinceAt(options.near[0], options.near[1]);
      if (here) wanted.add(here);
      for (const p of ringAround(options.near, BORDER_RING_M)) {
        const plate = config.borders.provinceAt(p[0], p[1]);
        if (plate) wanted.add(plate);
      }
      if (explicit) wanted.add(explicit);
      const needed = [...wanted].sort();
      const plates = needed.filter((p) => installed.includes(p));
      if (plates.length > 0 || needed.length > 0) return { plates, missing: needed.filter((p) => !installed.includes(p)), needed };
    }
    if (installed.length > MAX_REGIONS) {
      const byDistrict = parsed.district ? [...new Set(findDistrict(parsed.district.name).flatMap((d) => (d.plate ? [d.plate] : [])))].filter((plate) => installed.includes(plate)) : [];
      if (byDistrict.length > 0 && !parsed.neighbourhood) return { plates: byDistrict.slice(0, MAX_REGIONS), missing: [], needed: [] };
      if (parsed.neighbourhood) {
        const byHood = await platesWithHood(parsed.neighbourhood, byDistrict.length > 0 ? byDistrict : installed);
        if (byHood.length > 0) return { plates: byHood.slice(0, MAX_REGIONS), missing: [], needed: [] };
      }
    }
    return { plates: installed.slice(0, MAX_REGIONS), missing: installed.slice(MAX_REGIONS), needed: [] };
  }

  async function learnedLayout(place: Place, block: string | null): Promise<BuildingLayout | null> {
    const parts = layerKeyOf(place.region, place.local ?? place.components);
    if (!parts) return null;
    const key = layoutKey(composeKey(parts), block ? blockKey(block) : null);
    for (const layer of layers) {
      const found = (await layer.layout?.(place.region, key)) ?? null;
      if (found) return found;
    }
    return null;
  }

  async function withUnit(place: Place, parsed: ParsedAddress): Promise<Place> {
    if (parsed.floor === null && parsed.door === null && parsed.block === null && parsed.entrance === null) return place;
    const reader = (await open(place.region))?.context.buildings2;
    if (!reader) return place;
    const base = await reader.at(place.coordinate, UNIT_TOLERANCE_M);
    if (!base) return place;
    let around: BuildingInfo[] = [];
    let target = base;
    if (parsed.block !== null) {
      for (const radius of [UNIT_NEAR_M, SITE_RADIUS_M]) {
        around = (await reader.near(place.coordinate, radius, UNIT_NEIGHBOURS)).map((n) => n.building);
        const block = resolveBlock(parsed.block, base, around);
        if (block) {
          target = block;
          break;
        }
      }
    }
    const found = await reader.entrances(target.id);
    const unit = resolveUnit({ floor: parsed.floor, door: parsed.door, block: parsed.block, entrance: parsed.entrance }, base, around, () => found, { layout: await learnedLayout(place, parsed.block) });
    return { ...place, unit };
  }

  async function resolveRelative(ask: RelationAsk, options: SearchOptions, limit: number): Promise<ResolveResult | null> {
    const base = await resolve(ask.query, { ...options, limit: Math.max(limit, LANDMARK_CANDIDATES) });
    if (base.status === 'region_missing' || base.status === 'not_found') return null;
    const landmark = (base.status === 'resolved' ? [base.best, ...base.candidates] : base.candidates).find((p) => p.precision === 'poi' || p.precision === 'address' || p.precision === 'interpolated');
    if (!landmark) return null;
    const entry = await open(landmark.region);
    const reader = entry?.context.buildings2;
    const linked = reader ? (await reader.near(landmark.coordinate, LANDMARK_LINK_M, 1))[0]?.building : undefined;
    if (!entry || !reader || !linked || linked.chain === null) return withNote(base, 'landmark_not_in_building');
    let targets: Target[] = [];
    const stretch = async (): Promise<BuildingInfo[]> => (linked.part === null || linked.along === null ? [] : reader.alongStreet(linked.chain as number, linked.part, linked.along - LANDMARK_STRETCH_M, linked.along + LANDMARK_STRETCH_M));
    if (ask.relation === 'opposite') targets = [oppositeOf(linked, await stretch())].filter((t): t is Target => t !== null);
    else if (ask.relation === 'beside') targets = besideOf(linked, await stretch());
    else if (ask.relation === 'corner') targets = [cornerOf(linked, (await reader.near(landmark.coordinate, CORNER_REACH_M, UNIT_NEIGHBOURS)).map((n) => n.building))].filter((t): t is Target => t !== null);
    else targets = [behindOf(linked, (await entry.context.region.partsOf(linked.chain)).flatMap((p) => p.lines))].filter((t): t is Target => t !== null);
    if (targets.length === 0) return withNote(base, 'relation_not_found');
    const name = landmark.components.poiName ?? landmark.label;
    const word = RELATION_LABEL[options.language ?? 'tr'][ask.relation];
    const places: Place[] = targets.map((t, i) => ({ ...landmark, id: `${landmark.id}~${ask.relation}${i}`, label: `${landmark.label} · ${word}`, coordinate: t.coordinate, precision: 'interpolated', approximate: true, source: 'derived', confidence: Math.round((RELATIVE_CONFIDENCE - i * 0.05) * 100) / 100, radiusM: t.radiusM, notes: ['relative_to_landmark'], relation: { kind: ask.relation, landmark: name } }));
    return { status: 'resolved', best: places[0] as Place, candidates: [...places, landmark].slice(0, limit) };
  }

  const shapes = new Map<string, Promise<PlaceShape | null>>();

  async function shapeFor(place: Place): Promise<PlaceShape | null> {
    let pending = shapes.get(place.id);
    if (!pending) {
      pending = (async () => {
        const plate = place.id.split(':')[0];
        const entry = plate ? await open(plate) : null;
        return entry ? shapeOf(entry.context.region, place, (plate) => config.borders.provinceBounds(plate)) : null;
      })().catch(() => null);
      shapes.set(place.id, pending);
      if (shapes.size > SHAPE_MEMO) shapes.delete(shapes.keys().next().value as string);
    }
    return pending;
  }

  async function withShapes(result: ResolveResult): Promise<ResolveResult> {
    if (result.status === 'region_missing') return result;
    const decorate = async (place: Place): Promise<Place> => {
      const shape = await shapeFor(place);
      return shape ? { ...place, ...(shape.bbox ? { bbox: shape.bbox } : {}), ...(shape.geometry ? { geometry: shape.geometry } : {}) } : place;
    };
    const first = result.status === 'resolved' ? [result.best, ...result.candidates] : result.candidates;
    const seen = new Map<string, Place>();
    for (const place of first.slice(0, SHAPE_PLACES)) seen.set(place.id, await decorate(place));
    const pick = (place: Place): Place => seen.get(place.id) ?? place;
    if (result.status === 'resolved') return { ...result, best: pick(result.best), candidates: result.candidates.map(pick) };
    return { ...result, candidates: result.candidates.map(pick) };
  }

  const PLACE_ID = /^(\d{2}):([ahds]):(\d+)(?::.*)?$/;

  async function withSid(place: Place): Promise<Place> {
    const m = PLACE_ID.exec(place.id);
    if (!m) return place;
    const entry = await open(m[1] as string);
    if (!entry) return place;
    const id = Number(m[3]);
    const sid = (await entry.context.region.sidsOf(m[2] as 'a' | 'h' | 'd' | 's', [id])).get(id);
    return sid ? { ...place, sid } : place;
  }

  async function withSids(result: ResolveResult): Promise<ResolveResult> {
    if (result.status === 'region_missing') return result;
    const first = result.status === 'resolved' ? [result.best, ...result.candidates] : result.candidates;
    const seen = new Map<string, Place>();
    for (const place of first) if (!seen.has(place.id)) seen.set(place.id, await withSid(place));
    const pick = (place: Place): Place => seen.get(place.id) ?? place;
    if (result.status === 'resolved') return { ...result, best: pick(result.best), candidates: result.candidates.map(pick) };
    return { ...result, candidates: result.candidates.map(pick) };
  }

  async function withPostcode(place: Place): Promise<Place> {
    const hood = place.components.neighbourhood;
    if (!config.neighbourhoods || !hood || place.components.postcode || !place.region) return place;
    const postcode = await config.neighbourhoods.postcodeOf(place.region, place.components.district, hood);
    return postcode ? { ...place, components: { ...place.components, postcode } } : place;
  }

  async function withPostcodes(result: ResolveResult): Promise<ResolveResult> {
    if (!config.neighbourhoods || result.status === 'region_missing') return result;
    const seen = new Map<string, Place>();
    for (const place of result.status === 'resolved' ? [result.best, ...result.candidates] : result.candidates) if (!seen.has(place.id)) seen.set(place.id, await withPostcode(place));
    const pick = (place: Place): Place => seen.get(place.id) ?? place;
    if (result.status === 'resolved') return { ...result, best: pick(result.best), candidates: result.candidates.map(pick) };
    return { ...result, candidates: result.candidates.map(pick) };
  }

  async function resolve(input: string | StructuredQuery, given: SearchOptions = {}): Promise<ResolveResult> {
    const result = await withPostcodes(await withSids(await resolveCore(input, given)));
    return given && given.geometry === true ? withShapes(result) : result;
  }

  async function lookup(id: string): Promise<Place | null> {
    const text = typeof id === 'string' ? id.trim() : '';
    let plate: string | null = null;
    let type: string | null = null;
    let row = 0;
    const legacy = PLACE_ID.exec(text);
    if (legacy) {
      plate = legacy[1] as string;
      type = legacy[2] as string;
      row = Number(legacy[3]);
    } else {
      const m = /^[DIHS](\d{2})/.exec(text);
      if (!m) return null;
      plate = m[1] as string;
      const entry = await open(plate);
      const found = entry ? await entry.context.region.idOfSid(text) : null;
      if (!found) return null;
      type = found.type;
      row = found.id;
    }
    const entry = await open(plate);
    if (!entry) return null;
    const ctx = { ...entry.context, language: 'tr' as Lang, hints: undefined };
    const region = ctx.region;
    const sid = (await region.sidsOf(type as 'a' | 'h' | 'd' | 's', [row])).get(row);
    const decorate = (place: Place): Place => (sid ? { ...place, sid } : place);
    if (type === 'd') {
      const d = region.districts.find((x) => x.id === row);
      return d ? decorate(scored(ctx, { id: `${plate}:d:${row}`, components: components(ctx, d.id, null), coordinate: d.center, precision: 'district', approximate: true, source: 'derived', score: 1, area: `${d.id}/0` }).place) : null;
    }
    if (type === 'h') {
      const h = region.hoods.find((x) => x.id === row);
      return h ? decorate(scored(ctx, { id: `${plate}:h:${row}`, components: components(ctx, h.districtId, h.id), coordinate: h.center ?? (region.districts.find((x) => x.id === h.districtId)?.center as LngLat), precision: 'neighbourhood', approximate: true, source: 'derived', score: 1, area: `${h.districtId}/${h.id}` }).place) : null;
    }
    if (type === 's') {
      const street = (await region.streetsByIds([row]))[0];
      const where = street ? (await region.hoodsOfStreet([row]))[0] : undefined;
      if (!street || !where) return null;
      const parts = await region.partsOf(row);
      return decorate(scored(ctx, { id: `${plate}:s:${row}:${where.hoodId ?? 0}`, components: components(ctx, where.districtId, where.hoodId, street), coordinate: streetPoint(ctx, parts, where.districtId, where.hoodId), precision: 'street', approximate: true, source: 'derived', score: 1, area: `${where.districtId}/${where.hoodId ?? 0}` }).place);
    }
    const found = (await region.db.all<{ street_id: number | null; district_id: number; hood_id: number | null; number: string; postcode: string | null; lon: number; lat: number }>('SELECT street_id, district_id, hood_id, number, postcode, lon, lat FROM address WHERE id = ?', [row]))[0];
    if (!found) return null;
    const street = found.street_id === null ? undefined : (await region.streetsByIds([found.street_id]))[0];
    return decorate(scored(ctx, { id: `${plate}:a:${row}`, components: components(ctx, found.district_id, found.hood_id, street, found.number, found.postcode), coordinate: [found.lon / 1e6, found.lat / 1e6], precision: 'address', approximate: false, source: 'osm', score: 1, area: `${found.district_id}/${found.hood_id ?? 0}` }).place);
  }

  async function resolveCore(input: string | StructuredQuery, given: SearchOptions = {}): Promise<ResolveResult> {
    const options = cleanOptions(given);
    const text = (typeof input === 'string' ? input : input && typeof input === 'object' ? structuredText(input) : '').slice(0, MAX_TEXT);
    const ask = typeof input === 'string' ? relationOf(nameKey(text)) : null;
    if (ask) {
      const relative = await resolveRelative(ask, options, limitOf(options.limit, DEFAULT_LIMIT, 1));
      if (relative) return relative;
    }
    const parsed = parse(text);
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
      if (!sure(own)) {
        for (const alt of parsed.alternatives) for (const s of await resolveInRegion(ctx, alt)) own.push({ ...s, score: s.score * ALTERNATIVE_FACTOR });
      }
      if (needsLearnedStreet(own, parsed, ctx)) {
        const named = await learnedStreet(ctx, parsed, own);
        if (named) own.push(named);
      } else if (needsProvinceStreet(own, parsed)) own.push(...(await learnedStreetsInProvince(ctx, parsed)));
      const withPlaces = !parsed.street || parsed.street.kind === null;
      if (withPlaces) own.push(...(await placesInRegion(ctx, parsed, options.near)));
      if (withPlaces && !parsed.houseNumber && !sure(own)) own.push(...(await buildingsByName(ctx, parsed, own)));
      else if (!parsed.houseNumber && !sure(own)) own.push(...(await placesOnWrittenStreet(ctx, parsed)));
      if (entry.extra && !sure(own)) {
        const other = { ...entry.extra, language, hints: options.hints };
        const listed: Scored[] = await resolveInRegion(other, parsed);
        if (!parsed.houseNumber && (withPlaces || !sure(own))) listed.push(...(await (withPlaces ? placesInRegion(other, parsed, options.near) : placesOnWrittenStreet(other, parsed))));
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
    const unique = rank(favourPlaces(scored, parsed, options.near), options.near);
    const candidates = unique.slice(0, limit).map((s) => s.place);
    const unavailable = [...new Set([...missing, ...failed])].sort();
    const extra = unavailable.length > 0 ? { missing: unavailable } : {};
    const top = unique[0];
    if (!top) return { status: 'not_found', candidates: [], ...extra };
    const decorated = await withUnit(top.place, parsed);
    if (decorated !== top.place) {
      const at = candidates.indexOf(top.place);
      if (at >= 0) candidates[at] = decorated;
      top.place = decorated;
    }
    const suggestion = didYouMean(parsed.street?.text ?? '', unique);
    const rival = unique.some((s) => s !== top && top.score - s.score < AMBIGUOUS_GAP && (s.area !== top.area || distanceM(s.place.coordinate, top.place.coordinate) > SAME_SPOT_M));
    if (rival) return { status: 'ambiguous', candidates, ...extra, ...suggestion };
    return { status: 'resolved', best: top.place, candidates, ...extra, ...suggestion };
  }

  const areaOf = (parsed: ParsedAddress, place: Place | undefined): { plate: string; district: string | undefined } | null => {
    const plate = place?.region ?? parsed.province?.id;
    return plate ? { plate, district: place?.components.district ?? parsed.district?.name } : null;
  };

  async function listedHood(parsed: ParsedAddress, place: Place | undefined): Promise<string | undefined> {
    const area = config.neighbourhoods && parsed.neighbourhood ? areaOf(parsed, place) : null;
    return area && config.neighbourhoods && parsed.neighbourhood ? (await config.neighbourhoods.suggest(area.plate, area.district, parsed.neighbourhood, 1))[0] : undefined;
  }

  async function postcodeIssue(parsed: ParsedAddress, result: ResolveResult): Promise<PostcodeCheck | null> {
    if (!config.neighbourhoods || result.status === 'region_missing') return null;
    const first = result.status === 'resolved' ? result.best : result.candidates[0];
    const area = areaOf(parsed, first);
    return area ? config.neighbourhoods.checkPostcode(parsed, area.plate, area.district) : null;
  }

  async function closeNames(parsed: ParsedAddress, result: ResolveResult): Promise<Suggestions> {
    if (result.status === 'region_missing') return {};
    const first = result.status === 'resolved' ? result.best : result.candidates[0];
    const plate = first?.region ?? (await config.store.installed())[0];
    const entry = plate ? await open(plate) : null;
    if (!entry) return {};
    const out: Suggestions = {};
    const region = entry.context.region;
    const near = (key: string, names: { key: string; name: string }[]): string | undefined => {
      const compact = key.replace(/ /g, '');
      if (compact.length < SUGGEST_MIN || names.some((n) => n.key === key)) return undefined;
      const allowed = compact.length <= SUGGEST_SHORT ? 1 : 2;
      let best: { name: string; distance: number } | undefined;
      for (const n of names) {
        const distance = editDistance(compact, n.key.replace(/ /g, ''), allowed);
        if (distance <= allowed && distance > 0 && (!best || distance < best.distance)) best = { name: n.name, distance };
      }
      return best?.name;
    };
    if (parsed.neighbourhood) {
      const typed = nameKey(parsed.neighbourhood);
      const hood = near(parsed.neighbourhood, region.hoods) ?? (region.hoods.some((h) => h.key === typed) ? undefined : await listedHood(parsed, first));
      if (hood) out.neighbourhood = hood;
    }
    if (!parsed.district) {
      for (const token of nameKey(parsed.input).split(' ')) {
        const district = near(token, region.districts);
        if (district) {
          out.district = district;
          break;
        }
      }
    }
    return out;
  }

  async function validate(input: string, given: SearchOptions = {}): Promise<Validation> {
    const options = cleanOptions(given);
    const text = (typeof input === 'string' ? input : '').slice(0, MAX_TEXT);
    const parsed = parse(text);
    const result = await resolve(text, { ...options, limit: VALIDATE_LIMIT });
    return analyse({ parsed, result, language: options.language ?? 'tr', suggestions: await closeNames(parsed, result), postcode: await postcodeIssue(parsed, result) });
  }

  return {
    resolve,
    lookup,
    async admin(query) {
      const installed = await config.store.installed();
      return adminLookup(
        {
          installed,
          async regionOf(plate) {
            const entry = installed.includes(plate) ? await open(plate) : null;
            return entry ? { region: entry.context.region, ...(entry.context.buildings2 ? { ranges: (chain: number) => (entry.context.buildings2 as NonNullable<typeof entry.context.buildings2>).ranges(chain) } : {}) } : null;
          },
        },
        query && typeof query === 'object' ? query : {},
      );
    },
    validate,
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
        const rows = await hoodRowsOf(id);
        if (!rows) continue;
        for (const hood of rows) labels.push({ region: id, name: shortHoodName(pickName(hood.names, language, hood.name)), lng: hood.center[0], lat: hood.center[1] });
      }
      return labels.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.lng - b.lng));
    },
    geometry: async (place) => shapeFor(place),
    async warm(plate) {
      const entry = await open(plate);
      if (!entry) return false;
      await entry.context.region.districtPolygons();
      await entry.context.buildings2?.near([0, 0], 1, 1);
      await Promise.all([entry.context.region.warm?.(), entry.extra?.region.warm?.()]);
      return true;
    },
    async arrival(place) {
      const entry = place.region ? await open(place.region) : null;
      const reader = entry?.context.buildings2;
      const find: EntranceFinder = async (chain) => {
        if (place.precision !== 'address' && place.precision !== 'poi' && place.precision !== 'interpolated') return null;
        const parts = layerKeyOf(place.region, place.local ?? place.components);
        if (parts) {
          const key = composeKey(parts);
          for (const layer of layers) {
            const found = (await layer.entrances?.(place.region, key)) ?? [];
            if (found[0]) return { point: found[0] };
          }
        }
        const building = reader ? await reader.at(place.coordinate, UNIT_TOLERANCE_M) : null;
        if (!reader || !building) return null;
        const picked = chooseEntrance(await reader.entrances(building.id), doorNumber(place.unit?.door ?? null), chain);
        return picked ? { point: picked.point, ref: picked.ref } : null;
      };
      return arrivalOf(entry?.context.region ?? null, place, find);
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
      const extra = (given && typeof given === 'object' ? given : {}) as AutocompleteOptions;
      const limit = limitOf(options.limit, AUTOCOMPLETE_LIMIT, 0);
      if (limit === 0) return [];
      const typed = (typeof text === 'string' ? text : '').slice(-AUTOCOMPLETE_TEXT);
      const language: Lang = options.language ?? 'tr';
      const saved = placesOf(extra.saved);
      const recent = placesOf(extra.recent);
      const stored = [...saved, ...recent];
      if (typed.trim() === '') return withCompletion(recentsAsPlaces(stored, '', limit, language));
      const parsed = parseAddress(typed);
      const started = Date.now();
      const budget = typeof extra.budgetMs === 'number' && Number.isFinite(extra.budgetMs) && extra.budgetMs > 0 ? extra.budgetMs : null;
      const stage = { deep: extra.deep !== false, deadline: budget === null ? null : started + budget };
      const session = extra.session && typeof extra.session === 'object' ? extra.session : undefined;
      const { plates } = await pickRegions(parsed, options);
      const scored: Scored[] = [];
      const readers: Record<string, NonNullable<RegionContext['buildings2']>> = {};
      for (const plate of plates) {
        const entry = await open(plate);
        if (!entry) continue;
        if (entry.context.buildings2) readers[plate] = entry.context.buildings2;
        const region = session ? sessionRegion(entry.context.region, session) : entry.context.region;
        const own = await autocompleteInRegion({ ...entry.context, region, language, hints: options.hints }, parsed, stage);
        scored.push(...(entry.extra && own.length < limit ? mergeDirectory(plate, own, await autocompleteInRegion({ ...entry.extra, language, hints: options.hints }, parsed, stage)) : own));
      }
      const own = new Map(stored.map((p, i) => [p.id, i < saved.length ? SAVED_BOOST : RECENT_BOOST]));
      const home = recent[0]?.components.district ?? saved[0]?.components.district ?? null;
      const boosted = scored.map((item) => {
        let score = item.score * (own.get(item.place.id) ?? 1);
        if (home !== null && item.place.components.district === home) score *= SAME_DISTRICT_BOOST;
        return score === item.score ? item : { ...item, score };
      });
      for (const place of recentsAsPlaces(stored, typed, limit, language)) {
        if (!boosted.some((b) => b.place.id === place.id)) boosted.push({ place, score: STORED_SCORE, area: place.id });
      }
      const top = rank(nearer(boosted, options.near), options.near).slice(0, limit).map((s) => s.place);
      const hinted = /[0-9]/.test(typed) && stage.deep && !(stage.deadline !== null && Date.now() > stage.deadline);
      const out: Place[] = [];
      for (const [index, place] of top.entries()) {
        const reader = readers[place.region];
        const hint = hinted && index < UNIT_HINTS && place.precision === 'address' && reader ? await unitHintFor(reader, place.coordinate) : null;
        out.push(...withCompletion([hint ? { ...place, unitHint: hint } : place]));
      }
      return out;
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
      const readers = new Map<string, Buildings2>();
      for (const plate of [...wanted].sort()) {
        const entry = installed.has(plate) ? await open(plate) : null;
        if (!entry) continue;
        regions.push(entry.context.region);
        if (entry.context.buildings2) readers.set(plate, entry.context.buildings2);
      }
      const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
      const hide = Array.isArray(options.hide) ? new Set(options.hide.filter((id): id is number => typeof id === 'number')) : undefined;
      return reversePoint(regions, config.borders, point, options.language, { readers, ...(finite(options.heading) !== undefined ? { heading: finite(options.heading) as number } : {}), ...(finite(options.accuracyM) !== undefined ? { accuracyM: finite(options.accuracyM) as number } : {}), ...(hide ? { hide } : {}) });
    },
  };
}

export type { Region };
