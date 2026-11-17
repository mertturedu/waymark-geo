import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { openBuildings2, pointInRing } from '../src/core/address/buildings2';
import { distanceM } from '../src/core/geo/distance';
import { streetKey } from '../src/core/text/street';
import { openSqlite } from '../src/node/sqlite';
import { recordMeasure } from '../tools/compare/measures';
import { openSearch, stats } from './addr-eval';
import type { Door as G8Door } from './addr-sets';
import { heldOut, pick, readSet, repoRoot, seeded, seedOf } from './addr-sets';
import { readDoors } from './addr-seq-eval';
import { addressPackOf } from './build-buildings-v2';

const PLATES = ['34', '06', '35', '16'];
const pct = (part: number, whole: number): number => (whole === 0 ? 0 : Number(((100 * part) / whole).toFixed(1)));

type Tally = { n: number; street: number; exact: number; near: number; any: number; errors: number[]; sAny: number; sExact: number; sNear: number };
const fresh = (): Tally => ({ n: 0, street: 0, exact: 0, near: 0, any: 0, errors: [], sAny: 0, sExact: 0, sNear: 0 });

async function checkHide(perPlate: number): Promise<void> {
  const search = await openSearch();
  const all: Record<string, Tally> = { anchored: fresh(), sparse: fresh() };
  const bySide: Record<string, number> = {};
  const precisions = new Map<string, number>();
  for (const plate of PLATES) {
    const file = addressPackOf(plate);
    const names = new Map((new DatabaseSync(file, { readOnly: true }).prepare('SELECT id, name FROM street_name').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
    const held = process.env.HELD === '1';
    const doors = readDoors(file).filter((d) => d.suffix === '' && (held ? true : d.street % 2 === 0));
    const byStreet = new Map<string, typeof doors>();
    for (const d of doors) byStreet.set(`${d.street}:${d.district}`, [...(byStreet.get(`${d.street}:${d.district}`) ?? []), d]);
    const rng = seeded(seedOf(`reverse-hide-${plate}`));
    const streets = [...byStreet.values()].filter((list) => list.length >= 3);
    for (let i = 0; i < perPlate && streets.length > 0; i++) {
      const list = pick(rng, streets);
      const door = held ? (pick(rng, list.filter((d) => heldOut(d.lon, d.lat)).concat([])) ?? pick(rng, list)) : pick(rng, list);
      if (held && !heldOut(door.lon, door.lat)) continue;
      const key = list.length >= 6 ? 'anchored' : 'sparse';
      const t = all[key] as Tally;
      const place = await search.reverse([door.lon, door.lat], { hide: [door.id] });
      t.n++;
      if (!place) continue;
      precisions.set(place.precision, (precisions.get(place.precision) ?? 0) + 1);
      if (place.side) bySide[place.side] = (bySide[place.side] ?? 0) + 1;
      t.errors.push(distanceM(place.coordinate, [door.lon, door.lat]));
      const streetOk = !!place.components.street && streetKey(place.components.street).key === streetKey(names.get(door.street) ?? '').key;
      if (streetOk) t.street++;
      const got = Number.parseInt(place.components.houseNumber ?? '', 10);
      if (Number.isFinite(got)) {
        t.any++;
        if (got === door.num) t.exact++;
        if (got % 2 === door.num % 2 && Math.abs(got - door.num) <= 2) t.near++;
        if (streetOk) {
          t.sAny++;
          if (got === door.num) t.sExact++;
          if (got % 2 === door.num % 2 && Math.abs(got - door.num) <= 2) t.sNear++;
        }
      }
    }
    if (process.env.PER_PLATE) console.log(plate, 'sokak', JSON.stringify(Object.fromEntries(Object.entries(all).map(([k, t]) => [k, [t.n, t.street]]))));
    search.invalidate(plate);
  }
  const result = Object.fromEntries(Object.entries(all).map(([k, t]) => [k, { n: t.n, street: pct(t.street, t.n), answered: pct(t.any, t.n), exact: pct(t.exact, t.n), within2: pct(t.near, t.n), exactOfAnswered: pct(t.exact, t.any), onRightStreet: { n: t.street, answered: pct(t.sAny, t.street), exact: pct(t.sExact, t.street), within2: pct(t.sNear, t.street) } }]));
  console.log('gizle-ters ara (OSM kapısı gizli):', JSON.stringify(result), Object.fromEntries(precisions));
  recordMeasure('a10_hide', { ...result, precisions: Object.fromEntries(precisions) });
}

async function checkInside(perPlate: number): Promise<void> {
  const search = await openSearch();
  let n = 0;
  let right = 0;
  let known = 0;
  for (const plate of PLATES) {
    const before = { n, right };
    const reader = await openBuildings2(openSqlite(join(repoRoot, 'dist', 'eval-packs', process.env.BUILD2 ?? 's5', plate, 'buildings2.sqlite')));
    const db = new DatabaseSync(join(repoRoot, 'dist', 'eval-packs', process.env.BUILD2 ?? 's5', plate, 'buildings2.sqlite'), { readOnly: true });
    const rows = db.prepare('SELECT id, lon, lat FROM building WHERE area >= 40 ORDER BY id').all() as { id: number; lon: number; lat: number }[];
    db.close();
    const rng = seeded(seedOf(`reverse-inside-${plate}`));
    for (let i = 0; i < perPlate; i++) {
      const row = pick(rng, rows);
      const point: [number, number] = [row.lon / 1e6, row.lat / 1e6];
      const at = await reader.at(point, 0.5);
      if (!at || at.id !== row.id || !pointInRing(point, at.ring)) continue;
      n++;
      const place = await search.reverse(point);
      if (place?.building?.id === row.id) right++;
      if (place?.precision === 'address') known++;
    }
    if (process.env.PER_PLATE) console.log(plate, 'bina içi', n - before.n, 'doğru', right - before.right);
    search.invalidate(plate);
  }
  const result = { n, right: pct(right, n), knownDoor: pct(known, n) };
  console.log(`bina içi nokta: ${n} nokta, doğru bina %${result.right}, kapısı bilinen %${result.knownDoor}`);
  recordMeasure('a10_inside', result);
}

type NomReverse = { address?: { road?: string; house_number?: string } };

async function nominatimReverse(point: [number, number]): Promise<NomReverse | null> {
  try {
    const response = await fetch(`http://127.0.0.1:8088/reverse?lat=${point[1]}&lon=${point[0]}&zoom=18&addressdetails=1&format=json`);
    return response.ok ? ((await response.json()) as NomReverse) : null;
  } catch {
    return null;
  }
}

async function checkNominatim(perPlate: number): Promise<void> {
  const search = await openSearch(undefined, false);
  const mine = fresh();
  const theirs = fresh();
  for (const plate of PLATES) {
    for (const r of readSet<G8Door>('g8', plate).slice(0, perPlate)) {
      const place = await search.reverse([r.lng, r.lat]);
      mine.n++;
      theirs.n++;
      const want = streetKey(r.street).key;
      if (place?.components.street && streetKey(place.components.street).key === want) mine.street++;
      const got = Number.parseInt(place?.components.houseNumber ?? '', 10);
      if (Number.isFinite(got)) {
        if (got === r.num) mine.exact++;
        if (got % 2 === r.num % 2 && Math.abs(got - r.num) <= 2) mine.near++;
      }
      const nom = await nominatimReverse([r.lng, r.lat]);
      if (nom?.address?.road && streetKey(nom.address.road).key === want) theirs.street++;
      const them = Number.parseInt(nom?.address?.house_number ?? '', 10);
      if (Number.isFinite(them)) {
        if (them === r.num) theirs.exact++;
        if (them % 2 === r.num % 2 && Math.abs(them - r.num) <= 2) theirs.near++;
      }
    }
    search.invalidate(plate);
  }
  const row = (t: Tally) => ({ n: t.n, street: pct(t.street, t.n), exact: pct(t.exact, t.n), within2: pct(t.near, t.n) });
  const result = { sdk: row(mine), nominatim: row(theirs) };
  console.log('G8 (OSM\'de olmayan işletme kapıları, rehber kapalı):', JSON.stringify(result));
  recordMeasure('a10_nominatim', result);
}

async function main(): Promise<void> {
  const check = process.argv[2] ?? 'hide';
  const count = Number(process.argv[3] ?? 300);
  if (check === 'hide') await checkHide(count);
  if (check === 'inside') await checkInside(count);
  if (check === 'nominatim') await checkNominatim(count);
}

void stats;
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
