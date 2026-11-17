import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { distanceM } from '../src/core/geo/distance';
import { recordMeasure } from '../tools/compare/measures';
import { openSearch, stats } from './addr-eval';
import type { PlaceRecord } from './addr-g7g8';
import { provinceName } from '../src/core/text/admin';
import { readDoors } from './addr-seq-eval';
import { addressPackOf } from './build-buildings-v2';
import { packsDir, pick, readSet, seedOf, seeded } from './addr-sets';

const PLATES = ['06', '10', '16', '20', '34', '35', '38', '41', '42', '45', '58', '59'];
const HIT_M = 30;

type Tally = { n: number; first: number; top3: number };
const bump = (tally: Tally, index: number): void => {
  tally.n++;
  if (index === 0) tally.first++;
  if (index >= 0 && index < 3) tally.top3++;
};
const pct = (part: number, whole: number): number => (whole === 0 ? 0 : Number(((100 * part) / whole).toFixed(1)));

async function photonTop3(r: PlaceRecord): Promise<[number, number][]> {
  const params = new URLSearchParams({ q: r.text, limit: '3', lang: 'default' });
  if (r.near) {
    params.set('lon', String(r.near[0]));
    params.set('lat', String(r.near[1]));
  }
  try {
    const response = await fetch(`http://127.0.0.1:2322/api?${params}`);
    if (!response.ok) return [];
    return ((await response.json()) as { features: { geometry: { coordinates: [number, number] } }[] }).features.map((f) => f.geometry.coordinates);
  } catch {
    return [];
  }
}

const FORMS = ['{name}', '{name} {district}', '{name} {district} {province}', '{name}, {district}'];

function osmPlaces(plate: string, count: number): PlaceRecord[] {
  const dir = join(packsDir(), plate);
  const file = readdirSync(dir).find((f) => f.startsWith('address-') && f.endsWith('.sqlite')) as string;
  const db = new DatabaseSync(join(dir, file), { readOnly: true });
  try {
    const rows = db.prepare('SELECT p.id id, p.name name, p.lon lon, p.lat lat, d.name district FROM poi p JOIN district d ON d.id = p.district_id ORDER BY p.id').all() as { id: number; name: string; lon: number; lat: number; district: string }[];
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
    const unique = rows.filter((r) => counts.get(r.name) === 1 && r.name.length >= 4);
    const rng = seeded(seedOf(`${plate}-osm-places`));
    const out: PlaceRecord[] = [];
    const used = new Set<number>();
    const province = provinceName(plate) ?? plate;
    while (out.length < Math.min(count, unique.length)) {
      const r = pick(rng, unique);
      if (used.has(r.id)) continue;
      used.add(r.id);
      const form = pick(rng, FORMS);
      const bearing = rng() * 2 * Math.PI;
      const away = 500 + rng() * 3500;
      const near: [number, number] | null = form === '{name}' ? [r.lon / 1e6 + (Math.cos(bearing) * away) / (111_320 * Math.cos((r.lat / 1e6 * Math.PI) / 180)), r.lat / 1e6 + (Math.sin(bearing) * away) / 111_320] : null;
      out.push({ id: `${plate}:o:${r.id}`, plate, poi: r.id, name: r.name, district: r.district, province, lng: r.lon / 1e6, lat: r.lat / 1e6, form, near, text: form.replace('{name}', r.name).replace('{district}', r.district).replace('{province}', province) });
    }
    return out;
  } finally {
    db.close();
  }
}

async function nominatimTop3(r: PlaceRecord): Promise<[number, number][]> {
  const params = new URLSearchParams({ q: r.text, format: 'json', limit: '3' });
  try {
    const response = await fetch(`http://127.0.0.1:8088/search?${params}`);
    if (!response.ok) return [];
    return ((await response.json()) as { lon: string; lat: string }[]).map((x) => [Number(x.lon), Number(x.lat)] as [number, number]);
  } catch {
    return [];
  }
}

async function checkOsm(limit: number): Promise<void> {
  let shown = 0;
  const search = await openSearch(undefined, false);
  const sdk: Tally = { n: 0, first: 0, top3: 0 };
  const photon: Tally = { n: 0, first: 0, top3: 0 };
  const nominatim: Tally = { n: 0, first: 0, top3: 0 };
  for (const plate of PLATES) {
    for (const r of osmPlaces(plate, limit)) {
      const result = await search.resolve(r.text, r.near ? { near: r.near } : {});
      const points = result.status === 'region_missing' ? [] : result.candidates.map((c) => c.coordinate);
      const index = points.findIndex((p) => distanceM(p, [r.lng, r.lat]) <= HIT_M);
      bump(sdk, index);
      if ((index < 0 || index >= 3) && process.env.MISSES && shown++ < Number(process.env.MISSES)) console.log('  kaçan:', r.form, '|', r.text, '→', result.status, result.status === 'region_missing' ? '' : result.candidates.slice(0, 3).map((c) => c.label.slice(0, 45)).join(' ; '));
      bump(photon, (await photonTop3(r)).findIndex((p) => distanceM(p, [r.lng, r.lat]) <= HIT_M));
      bump(nominatim, (await nominatimTop3(r)).findIndex((p) => distanceM(p, [r.lng, r.lat]) <= HIT_M));
    }
    search.invalidate(plate);
  }
  const result = { count: sdk.n, sdkFirst: pct(sdk.first, sdk.n), sdkTop3: pct(sdk.top3, sdk.n), photonFirst: pct(photon.first, photon.n), photonTop3: pct(photon.top3, photon.n), nominatimFirst: pct(nominatim.first, nominatim.n), nominatimTop3: pct(nominatim.top3, nominatim.n) };
  console.log(`G7 OSM yerleri (${sdk.n} kayıt, rehber kapalı): SDK ilk %${result.sdkFirst}, ilk 3 %${result.sdkTop3}; Photon ilk %${result.photonFirst}, ilk 3 %${result.photonTop3}; Nominatim ilk %${result.nominatimFirst}, ilk 3 %${result.nominatimTop3}`);
  recordMeasure(process.env.G7_KEY ? `${process.env.G7_KEY}_osm` : 'a8_g7_osm', result);
}

async function checkG7(limit: number): Promise<void> {
  const search = await openSearch();
  const sdk: Tally = { n: 0, first: 0, top3: 0 };
  const peer: Tally = { n: 0, first: 0, top3: 0 };
  const byForm = new Map<string, { sdk: Tally; photon: Tally }>();
  const ms: number[] = [];
  for (const plate of PLATES) {
    for (const r of readSet<PlaceRecord>('g7', plate).slice(0, limit)) {
      const started = performance.now();
      const result = await search.resolve(r.text, r.near ? { near: r.near } : {});
      ms.push(performance.now() - started);
      const points = result.status === 'region_missing' ? [] : result.candidates.map((c) => c.coordinate);
      const mine = points.findIndex((p) => distanceM(p, [r.lng, r.lat]) <= HIT_M);
      const theirs = (await photonTop3(r)).findIndex((p) => distanceM(p, [r.lng, r.lat]) <= HIT_M);
      const form = byForm.get(r.form) ?? { sdk: { n: 0, first: 0, top3: 0 }, photon: { n: 0, first: 0, top3: 0 } };
      byForm.set(r.form, form);
      bump(sdk, mine);
      bump(peer, theirs);
      bump(form.sdk, mine);
      bump(form.photon, theirs);
    }
    search.invalidate(plate);
  }
  const speed = stats(ms);
  const forms = Object.fromEntries([...byForm].map(([k, v]) => [k, { n: v.sdk.n, sdkTop3: pct(v.sdk.top3, v.sdk.n), photonTop3: pct(v.photon.top3, v.photon.n) }]));
  const result = { count: sdk.n, sdkFirst: pct(sdk.first, sdk.n), sdkTop3: pct(sdk.top3, sdk.n), photonFirst: pct(peer.first, peer.n), photonTop3: pct(peer.top3, peer.n), medianMs: speed.median, p90Ms: speed.p90, forms };
  console.log(`G7 (${sdk.n} kayıt, ${PLATES.length} il): SDK ilk %${result.sdkFirst}, ilk 3 %${result.sdkTop3}; Photon ilk %${result.photonFirst}, ilk 3 %${result.photonTop3}; süre ortanca ${speed.median} ms, p90 ${speed.p90} ms`);
  for (const [k, v] of Object.entries(forms)) console.log(`  ${k.padEnd(28)} ${String(v.n).padStart(5)}  SDK %${v.sdkTop3}  Photon %${v.photonTop3}`);
  recordMeasure(process.env.G7_KEY ?? 'a8_g7', result);
}

const LANDMARK_PLATES = ['34', '06', '35', '16', '41'];
const REACH_M = 50;

type DoorRow = { id: number; street: number; district: number; num: number; suffix: string; parity: number; lon: number; lat: number };

async function checkLandmark(perPlate: number): Promise<void> {
  const search = await openSearch();
  const reasons = new Map<string, number>();
  const tally: Record<string, { n: number; near: number; missed: number; errors: number[] }> = { opposite: { n: 0, near: 0, missed: 0, errors: [] }, beside: { n: 0, near: 0, missed: 0, errors: [] } };
  for (const plate of LANDMARK_PLATES) {
    const file = addressPackOf(plate);
    const db = new DatabaseSync(file, { readOnly: true });
    const names = new Map((db.prepare('SELECT id, name FROM street_name').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
    const districts = new Map((db.prepare('SELECT id, name FROM district').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
    db.close();
    const doors: DoorRow[] = readDoors(file).filter((d) => d.suffix === '');
    const byStreet = new Map<string, DoorRow[]>();
    for (const d of doors) byStreet.set(`${d.street}:${d.district}`, [...(byStreet.get(`${d.street}:${d.district}`) ?? []), d]);
    const rng = seeded(seedOf(`landmark-${plate}`));
    const streets = [...byStreet.values()].filter((list) => list.length >= 8);
    let done = 0;
    while (done < perPlate && streets.length > 0) {
      const list = pick(rng, streets);
      const door = pick(rng, list);
      const byNum = new Map(list.map((d) => [d.num, d]));
      const opposite = [1, 3, -1, -3].map((delta) => byNum.get(door.num + delta)).filter((d): d is DoorRow => d !== undefined && d.parity !== door.parity);
      const beside = [byNum.get(door.num + 2), byNum.get(door.num - 2)].filter((d): d is DoorRow => d !== undefined);
      const text = (relation: string): string => `${names.get(door.street)} ${door.num} ${relation} ${districts.get(door.district)} ${provinceName(plate)}`;
      for (const [kind, word, truth] of [['opposite', 'karşısı', opposite], ['beside', 'yanı', beside]] as const) {
        if (truth.length === 0) continue;
        const result = await search.resolve(text(word));
        const t = tally[kind] as (typeof tally)[string];
        t.n++;
        const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
        if (!best?.relation) {
          reasons.set(best?.notes?.[0] ?? (best ? 'landmark_other' : 'landmark_none'), (reasons.get(best?.notes?.[0] ?? (best ? 'landmark_other' : 'landmark_none')) ?? 0) + 1);
          t.missed++;
          t.errors.push(100_000);
          continue;
        }
        const error = Math.min(...truth.map((d) => distanceM(best.coordinate, [d.lon, d.lat])));
        t.errors.push(error);
        if (error <= REACH_M) t.near++;
      }
      done++;
    }
    search.invalidate(plate);
  }
  console.log('cevapsız nedenleri', Object.fromEntries(reasons));
  const result = Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, { ...stats(v.errors), n: v.n, near: pct(v.near, v.n), answered: pct(v.n - v.missed, v.n) }]));
  const all = Object.values(tally).reduce((a, v) => ({ n: a.n + v.n, near: a.near + v.near }), { n: 0, near: 0 });
  console.log(`yer işaretine göre (kapı numarası vekili): karşısı ${JSON.stringify(result.opposite)}\n  yanı ${JSON.stringify(result.beside)}\n  toplam ≤${REACH_M} m %${pct(all.near, all.n)} (${all.n} vaka)`);
  recordMeasure('a8_landmark', { ...result, count: all.n, near: pct(all.near, all.n), proxy: true });
}

async function main(): Promise<void> {
  const check = process.argv[2] ?? 'g7';
  if (check === 'g7') await checkG7(Number(process.argv[3] ?? 300));
  if (check === 'osm') await checkOsm(Number(process.argv[3] ?? 200));
  if (check === 'landmark') await checkLandmark(Number(process.argv[3] ?? 200));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
