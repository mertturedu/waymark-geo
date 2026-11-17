import type { LngLat } from '../geo/cells';
import { distanceM } from '../geo/distance';
import { layerKeyOf } from '../learn/key';
import { numberAsWords } from '../text/digits';
import { nameKey } from '../text/fold';
import { houseNumberKey, type HouseNumber } from '../text/number';
import type { BuildingSnap } from './buildings';
import { cachedStreetKey } from './key-cache';
import { editDistance, kindFactor, nameScore } from './names';
import type { AddressRow, DistrictInfo, HoodInfo, PartRow, Region, StreetRow } from './pack';
import { ONE_SIDED_FLOOR, predictNumber, streetMiddle, type Variant } from './predict';
import { streetKey, streetLabel, type StreetKey } from '../text/street';
import type { Lang, ParsedAddress } from '../text/types';
import { formatLabel } from './label';
import { localizeComponents } from './localize';
import type { Components, Hints, LayerKey, LayerNeighbour, LayerPoint, Place, PointLayer, Precision, Source } from './types';

export type Scored = { place: Place; score: number; area: string };

export type RegionContext = {
  region: Region;
  provinceName: string;
  official: Map<number, string | null>;
  layers: PointLayer[];
  language: Lang;
  hints?: Hints;
  findDistrictId: (name: string) => string | null;
  variant?: Variant;
  snap?: BuildingSnap;
};

const SAME_DOOR_M = 30;
export const MIN_NAME = 0.55;
const STREETS_KEPT = 8;
const MAX_LOCS = 12;
const SPELLED_OTHER = 0.95;
const SPELLED_MIN = 0.94;
const NUMBER_MISSING = 0.7;
const NUMBER_GUESSED = 0.85;
const NUMBER_ONE_SIDED = 0.75;
const HOOD_MISSING = 0.8;
const DISTRICT_MISMATCH = 0.55;
const round = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;

export function matchDistricts(ctx: RegionContext, parsed: ParsedAddress): Set<number> | null {
  const found = new Set<number>();
  let asked = false;
  if (parsed.district) {
    asked = true;
    const key = nameKey(parsed.district.name);
    for (const d of ctx.region.districts) if (ctx.official.get(d.id) === parsed.district.id || d.key === key) found.add(d.id);
  } else if (ctx.hints?.district) {
    asked = true;
    const id = ctx.findDistrictId(ctx.hints.district);
    const key = nameKey(ctx.hints.district);
    for (const d of ctx.region.districts) if ((id !== null && ctx.official.get(d.id) === id) || d.key === key) found.add(d.id);
  }
  return asked ? found : null;
}

export function matchHoods(ctx: RegionContext, text: string, within: Set<number> | null): Map<number, number> {
  const key = nameKey(text);
  const compact = key.replace(/ /g, '');
  const found = new Map<number, number>();
  if (key === '') return found;
  for (const h of ctx.region.hoods) {
    if (within && within.size > 0 && !within.has(h.districtId)) continue;
    const other = h.key.replace(/ /g, '');
    let score = 0;
    if (h.key === key) score = 1;
    else if (other === compact) score = 0.98;
    else if (compact.length >= 5 && editDistance(compact, other, 1) <= 1) score = 0.85;
    if (score > 0) found.set(h.id, score);
  }
  return found;
}

export const districtOf = (ctx: RegionContext, id: number): DistrictInfo => ctx.region.districts.find((d) => d.id === id) as DistrictInfo;
export const hoodOf = (ctx: RegionContext, id: number | null): HoodInfo | null => (id === null ? null : (ctx.region.hoods.find((h) => h.id === id) ?? null));

export function components(ctx: RegionContext, districtId: number, hoodId: number | null, street?: StreetRow, number?: string, postcode?: string | null): Components {
  const out: Components = { province: ctx.provinceName, district: districtOf(ctx, districtId).name };
  const hood = hoodOf(ctx, hoodId);
  if (hood) out.neighbourhood = hood.name;
  if (street) out.street = street.name;
  if (number) out.houseNumber = number;
  if (postcode) out.postcode = postcode;
  return out;
}

export type Make = { id: string; components: Components; coordinate: LngLat; precision: Precision; approximate: boolean; source: Source; score: number; area: string };

export function scored(ctx: RegionContext, make: Make): Scored {
  const shown = localizeComponents(ctx, make.components);
  return {
    score: make.score,
    area: make.area,
    place: {
      id: make.id,
      label: formatLabel(shown, ctx.language),
      components: shown,
      ...(shown === make.components ? {} : { local: make.components }),
      coordinate: make.coordinate,
      precision: make.precision,
      approximate: make.approximate,
      source: make.source,
      confidence: round(make.score),
      region: ctx.region.id,
    },
  };
}

export function streetPoint(ctx: RegionContext, parts: PartRow[], districtId: number, hoodId: number | null): LngLat {
  return streetMiddle(parts, districtId, hoodId) ?? hoodOf(ctx, hoodId)?.center ?? districtOf(ctx, districtId).center;
}

async function neighboursOf(ctx: RegionContext, key: LayerKey): Promise<LayerNeighbour[]> {
  const scope = { region: key.region, district: key.district, neighbourhood: key.neighbourhood, street: key.street };
  const byNumber = new Map<number, LayerNeighbour>();
  for (const layer of ctx.layers) {
    for (const n of (await layer.nearby?.(scope)) ?? []) {
      const have = byNumber.get(n.int);
      if (!have || (n.trusted && !have.trusted)) byNumber.set(n.int, n);
    }
  }
  return [...byNumber.values()];
}

type Layered = LayerPoint & { layer: 'learned' | 'correction' };

async function lookupLayers(ctx: RegionContext, key: LayerKey): Promise<Layered | null> {
  let first: Layered | null = null;
  for (const layer of ctx.layers) {
    const point = await layer.lookup(key);
    if (!point) continue;
    if (point.trusted) return { ...point, layer: layer.name };
    first ??= { ...point, layer: layer.name };
  }
  return first;
}

async function viaStreet(ctx: RegionContext, parsed: ParsedAddress, hn: HouseNumber | null, districts: Set<number> | null, hoods: Map<number, number> | null, out: Scored[]): Promise<void> {
  const asked = parsed.street as NonNullable<ParsedAddress['street']>;
  const query: StreetKey = { ...streetKey(asked.text), kind: asked.kind ?? streetKey(asked.text).kind };
  const best = new Map<number, number>();
  const typed = ` ${nameKey(parsed.input)} `;
  const words = query.numberOnly && query.numbers.length === 1 ? numberAsWords(Number(query.numbers[0])) : [];
  const spelled = words.some((w) => typed.includes(` ${w} `));
  const variants: { key: StreetKey; weight: number }[] = [{ key: query, weight: spelled ? SPELLED_OTHER : 1 }, ...words.map((w) => ({ key: { ...streetKey(w), kind: query.kind }, weight: spelled ? 1 : SPELLED_OTHER }))];
  for (const { key, weight } of variants) {
    for (const c of await ctx.region.streetCandidates(key.key, 'street')) {
      const raw = nameScore(key, cachedStreetKey(c.key)).score;
      if (key !== query && raw < SPELLED_MIN) continue;
      const value = raw * weight;
      if (value > (best.get(c.ref) ?? 0)) best.set(c.ref, value);
    }
  }
  const refs = [...best].filter((s) => s[1] >= MIN_NAME).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, STREETS_KEPT);
  if (refs.length === 0) return;
  const ids = refs.map((r) => r[0]);
  const rows = new Map((await ctx.region.streetsByIds(ids)).map((r) => [r.id, r]));
  const places = await ctx.region.hoodsOfStreet(ids);
  for (const [ref, baseValue] of refs) {
    const street = rows.get(ref);
    if (!street) continue;
    const nameValue = baseValue * kindFactor(query.kind, street.kind, query.numberOnly && street.number !== null);
    await emitStreet(ctx, street, nameValue, places.filter((p) => p.nameId === ref), hn, districts, hoods, out);
  }
}

export type StreetPlace = { districtId: number; hoodId: number | null };

export async function emitStreet(ctx: RegionContext, street: StreetRow, nameValue: number, locs: StreetPlace[], hn: HouseNumber | null, districts: Set<number> | null, hoods: Map<number, number> | null, out: Scored[]): Promise<void> {
  const ref = street.id;
  const parts = await ctx.region.partsOf(ref);
  const addresses: AddressRow[] = hn ? await ctx.region.addressesOf(ref, hn.key) : [];
  const factorOf = (loc: { districtId: number; hoodId: number | null }): number => {
    const districtFactor = !districts || districts.has(loc.districtId) ? 1 : DISTRICT_MISMATCH;
    const hoodFactor = !hoods ? 1 : loc.hoodId !== null && hoods.has(loc.hoodId) ? 0.9 + 0.1 * (hoods.get(loc.hoodId) as number) : HOOD_MISSING;
    return nameValue * districtFactor * hoodFactor;
  };
  const ranked = [...locs].sort((a, b) => factorOf(b) - factorOf(a)).slice(0, MAX_LOCS);
  const layerable = hn !== null && ctx.layers.length > 0;
  for (const loc of ranked) {
    const factor = factorOf(loc);
    const area = `${loc.districtId}/${loc.hoodId ?? 0}`;
    const here = addresses.filter((a) => a.districtId === loc.districtId && a.hoodId === loc.hoodId);
    const asked = layerable ? layerKeyOf(ctx.region.id, components(ctx, loc.districtId, loc.hoodId, street, (hn as HouseNumber).raw)) : null;
    const layerPoint = asked ? await lookupLayers(ctx, asked) : null;
    if (layerPoint && (layerPoint.trusted || here.length === 0)) {
      out.push(
        scored(ctx, {
          id: here[0] ? `${ctx.region.id}:a:${here[0].id}` : `${ctx.region.id}:l:${ref}:${(hn as HouseNumber).key}:${loc.districtId}:${loc.hoodId ?? 0}`,
          components: components(ctx, loc.districtId, loc.hoodId, street, here[0]?.number ?? (hn as HouseNumber).raw, here[0]?.postcode),
          coordinate: layerPoint.coordinate,
          precision: layerPoint.trusted ? 'address' : 'interpolated',
          approximate: !layerPoint.trusted,
          source: layerPoint.layer,
          score: factor,
          area,
        }),
      );
      continue;
    }
    if (hn && here.length > 0) {
      for (const a of here) {
        out.push(scored(ctx, { id: `${ctx.region.id}:a:${a.id}`, components: components(ctx, loc.districtId, loc.hoodId, street, a.number, a.postcode), coordinate: [a.lng, a.lat], precision: 'address', approximate: false, source: 'osm', score: factor, area }));
      }
      continue;
    }
    const extra = asked && hn && hn.int !== null && hn.int > 0 ? await neighboursOf(ctx, asked) : [];
    const guess = hn && hn.int !== null && hn.int > 0 ? await predictNumber(ctx.region, { id: ref, hoodId: loc.hoodId, districtId: loc.districtId }, { int: hn.int, key: hn.key, parity: hn.parity === 'odd' ? 1 : 0 }, { parts, variant: ctx.variant, snap: ctx.snap, extra }) : null;
    if (hn && guess && guess.precision === 'interpolated' && !(guess.variant === 'one-sided' && guess.confidence <= ONE_SIDED_FLOOR)) {
      out.push(
        scored(ctx, {
          id: `${ctx.region.id}:g:${ref}:${hn.key}:${loc.hoodId ?? 0}`,
          components: components(ctx, loc.districtId, loc.hoodId, street, hn.raw),
          coordinate: guess.coordinate,
          precision: 'interpolated',
          approximate: true,
          source: 'interpolated',
          score: factor * (guess.variant === 'one-sided' ? NUMBER_ONE_SIDED : NUMBER_GUESSED),
          area,
        }),
      );
      continue;
    }
    out.push(
      scored(ctx, {
        id: `${ctx.region.id}:s:${ref}:${loc.hoodId ?? 0}`,
        components: components(ctx, loc.districtId, loc.hoodId, street),
        coordinate: streetPoint(ctx, parts, loc.districtId, loc.hoodId),
        precision: 'street',
        approximate: true,
        source: 'derived',
        score: hn ? factor * NUMBER_MISSING : factor,
        area,
      }),
    );
  }
}

async function viaHoodNumber(ctx: RegionContext, hn: HouseNumber, hoods: Map<number, number>, out: Scored[]): Promise<void> {
  for (const [hoodId, value] of [...hoods].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, STREETS_KEPT)) {
    const rows = await ctx.region.addressesWithoutStreet(hoodId, hn.key);
    const hood = hoodOf(ctx, hoodId) as HoodInfo;
    const asked = ctx.layers.length > 0 ? layerKeyOf(ctx.region.id, components(ctx, hood.districtId, hoodId, undefined, hn.raw)) : null;
    const layerPoint = asked ? await lookupLayers(ctx, asked) : null;
    if (layerPoint && (layerPoint.trusted || rows.length === 0)) {
      out.push(
        scored(ctx, {
          id: rows[0] ? `${ctx.region.id}:a:${rows[0].id}` : `${ctx.region.id}:l:h${hoodId}:${hn.key}`,
          components: components(ctx, hood.districtId, hoodId, undefined, rows[0]?.number ?? hn.raw, rows[0]?.postcode),
          coordinate: layerPoint.coordinate,
          precision: layerPoint.trusted ? 'address' : 'interpolated',
          approximate: !layerPoint.trusted,
          source: layerPoint.layer,
          score: value * 0.9,
          area: `${hood.districtId}/${hoodId}`,
        }),
      );
      continue;
    }
    for (const a of rows) {
      out.push(scored(ctx, { id: `${ctx.region.id}:a:${a.id}`, components: components(ctx, a.districtId, a.hoodId, undefined, a.number, a.postcode), coordinate: [a.lng, a.lat], precision: 'address', approximate: false, source: 'osm', score: value * 0.9, area: `${a.districtId}/${a.hoodId ?? 0}` }));
    }
  }
}

function viaArea(ctx: RegionContext, parsed: ParsedAddress, districts: Set<number> | null, hoods: Map<number, number> | null, out: Scored[], lost = 1): void {
  const extra = (parsed.leftover.length > 0 || parsed.building || parsed.poiName ? 0.85 : 1) * lost;
  if (hoods && hoods.size > 0) {
    for (const [hoodId, value] of [...hoods].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, STREETS_KEPT)) {
      const hood = hoodOf(ctx, hoodId) as HoodInfo;
      out.push(scored(ctx, { id: `${ctx.region.id}:h:${hoodId}`, components: components(ctx, hood.districtId, hoodId), coordinate: hood.center ?? districtOf(ctx, hood.districtId).center, precision: 'neighbourhood', approximate: true, source: 'derived', score: 0.9 * value * extra, area: `${hood.districtId}/${hoodId}` }));
    }
    return;
  }
  if (parsed.district && districts && districts.size > 0) {
    for (const id of [...districts].sort((a, b) => a - b)) {
      out.push(scored(ctx, { id: `${ctx.region.id}:d:${id}`, components: components(ctx, id, null), coordinate: districtOf(ctx, id).center, precision: 'district', approximate: true, source: 'derived', score: 0.9 * extra, area: `${id}/0` }));
    }
  }
}

function collapseDoors(items: Scored[]): Scored[] {
  const kept: Scored[] = [];
  const order = [...items].sort((a, b) => b.score - a.score || (a.place.id < b.place.id ? -1 : 1));
  for (const item of order) {
    const isDoor = item.place.precision === 'address' && item.place.source === 'osm';
    const twin = isDoor && kept.some((k) => k.place.precision === 'address' && k.place.source === 'osm' && k.area === item.area && k.place.components.houseNumber === item.place.components.houseNumber && distanceM(k.place.coordinate, item.place.coordinate) <= SAME_DOOR_M);
    if (!twin) kept.push(item);
  }
  return kept;
}

const HOOD_WORDS_MAX = 3;

function splitHood(ctx: RegionContext, parsed: ParsedAddress, districts: Set<number> | null): ParsedAddress | null {
  const street = parsed.street;
  if (!street || parsed.neighbourhood) return null;
  const words = street.key.split(' ');
  for (let k = 1; k < words.length && k <= HOOD_WORDS_MAX; k++) {
    const head = words.slice(0, k).join(' ');
    if (![...matchHoods(ctx, head, districts).values()].some((v) => v >= 0.98)) continue;
    const rest = words.slice(k).join(' ');
    return { ...parsed, neighbourhood: head, street: { ...street, text: rest, key: rest, compact: rest.replace(/ /g, ''), number: /^\d+$/.test(rest) ? Number(rest) : null } };
  }
  return null;
}

const STREET_NOT_FOUND = 0.8;

async function viaLearnedStreet(ctx: RegionContext, parsed: ParsedAddress, hn: HouseNumber | null, districts: Set<number> | null, hoods: Map<number, number> | null, out: Scored[]): Promise<void> {
  if (ctx.layers.length === 0 || !hn || !parsed.street) return;
  const targets: { districtId: number; hoodId: number | null; value: number }[] = [];
  if (hoods && hoods.size > 0) {
    for (const [hoodId, value] of [...hoods].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, STREETS_KEPT)) targets.push({ districtId: (hoodOf(ctx, hoodId) as HoodInfo).districtId, hoodId, value });
  } else if (districts) {
    for (const districtId of [...districts].sort((a, b) => a - b)) targets.push({ districtId, hoodId: null, value: 1 });
  }
  for (const target of targets) {
    const base = { ...components(ctx, target.districtId, target.hoodId, undefined, hn.raw), street: streetLabel(parsed.street) };
    const key = layerKeyOf(ctx.region.id, base);
    const found = key ? await lookupLayers(ctx, key) : null;
    if (!key || !found) continue;
    out.push(
      scored(ctx, {
        id: `${ctx.region.id}:l:u${target.districtId}:${target.hoodId ?? 0}:${hn.key}:${encodeURIComponent(key.street)}`,
        components: base,
        coordinate: found.coordinate,
        precision: found.trusted ? 'address' : 'interpolated',
        approximate: !found.trusted,
        source: found.layer,
        score: target.value * (found.trusted ? 0.95 : 0.85),
        area: `${target.districtId}/${target.hoodId ?? 0}`,
      }),
    );
  }
}

function inAskedArea(item: Scored, districts: Set<number> | null, hoods: Map<number, number> | null): boolean {
  const [district, hood] = item.area.split('/').map(Number) as [number, number];
  if (hoods && hoods.size > 0) return hoods.has(hood);
  return districts !== null && districts.has(district);
}

export async function resolveInRegion(ctx: RegionContext, parsed: ParsedAddress): Promise<Scored[]> {
  const out: Scored[] = [];
  const hn = parsed.houseNumber ? houseNumberKey(parsed.houseNumber) : null;
  const districts = matchDistricts(ctx, parsed);
  const hoods = parsed.neighbourhood ? matchHoods(ctx, parsed.neighbourhood, districts) : null;
  if (parsed.street) {
    await viaStreet(ctx, parsed, hn, districts, hoods, out);
    const asked = (hoods !== null && hoods.size > 0) || (districts !== null && districts.size > 0);
    if (asked && !out.some((item) => inAskedArea(item, districts, hoods))) {
      const split = out.length === 0 ? splitHood(ctx, parsed, districts) : null;
      if (split) return resolveInRegion(ctx, split);
      await viaLearnedStreet(ctx, parsed, hn, districts, hoods, out);
      viaArea(ctx, parsed, districts, hoods, out, STREET_NOT_FOUND);
    }
  } else if (hn && hoods && hoods.size > 0) await viaHoodNumber(ctx, hn, hoods, out);
  else if (!hn) viaArea(ctx, parsed, districts, hoods, out);
  if (out.length === 0) {
    const split = splitHood(ctx, parsed, districts);
    if (split) return resolveInRegion(ctx, split);
  }
  return collapseDoors(out);
}
