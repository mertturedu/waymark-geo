import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { arrivalOf } from '../src/core/address/arrival';
import { openBuildings2 } from '../src/core/address/buildings2';
import { openRegion, type Region } from '../src/core/address/pack';
import { createSearch, type Search } from '../src/core/address/search';
import { nearestLine } from '../src/core/address/reverse-street';
import type { Place } from '../src/core/address/types';
import type { LngLat } from '../src/core/geo/cells';
import { distanceM } from '../src/core/geo/distance';
import { embeddedBorders } from '../src/core/region/embedded';
import { CHAIN_TOL_M } from '../src/core/route/snap';
import { createRouter, type Router } from '../src/core/route/router';
import { openSqlite } from '../src/node/sqlite';
import { rng, shuffle } from '../test/sim/random';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const CHECKS = ['chain', 'entrance', 'speed'];
export const PLATES = ['41', '16', '34', '35', '06'];
export const LIMITS = { chainOnChain: 0.99, doorSlackM: 5, speedP95Ms: 15 };
const SEED = 1515;
const DOORS = 240;
const ENTRANCES = 200;
const ORIGIN_M = 1500;
const M_PER_DEGREE = 111_195;

export type Measured = { check: string; pass: boolean; measured: string; report: string };

const percent = (share: number): string => `%${(share * 100).toFixed(1)}`;
const quantile = (list: number[], q: number): number => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] as number);
};

type Door = { id: number; streetId: number; hoodId: number | null; districtId: number; point: LngLat; number: string; street: string };

type Setup = { plate: string; region: Region; router: Router; search: Search; doorsOf: () => Promise<Door[]>; buildings: Awaited<ReturnType<typeof openBuildings2>> | null; close: () => Promise<void> };

const WORKS = { route: join(repoRoot, 'dist', 'work', '261028', 'packs'), address: join(repoRoot, 'dist', 'work', '261028', 'packs') };

async function setup(plate: string): Promise<Setup | null> {
  const routeFile = join(WORKS.route, plate, 'route.bin');
  const addressFile = join(WORKS.address, plate, 'address.sqlite');
  if (!existsSync(routeFile) || !existsSync(addressFile)) return null;
  const db = openSqlite(addressFile);
  const region = await openRegion(db);
  const buildingsFile = join(WORKS.address, plate, 'buildings2.sqlite');
  const b2 = existsSync(buildingsFile) ? openSqlite(buildingsFile) : null;
  const bytes = new Uint8Array(readFileSync(routeFile));
  const router = createRouter({ store: { installed: async () => [plate], read: async () => bytes }, borders: embeddedBorders() });
  const search = createSearch({ store: { installed: async () => [plate], open: async () => db, openPart: async (_: string, kind: string) => (kind === 'buildings2' ? b2 : null) }, borders: embeddedBorders() });
  return {
    plate,
    region,
    router,
    search,
    buildings: b2 ? await openBuildings2(b2) : null,
    doorsOf: async () => {
      const rows = await db.all<{ id: number; street_id: number; hood_id: number | null; district_id: number; lon: number; lat: number; number: string; name: string }>('SELECT a.id, a.street_id, a.hood_id, a.district_id, a.lon, a.lat, a.number, s.name FROM address a JOIN street_name s ON s.id = a.street_id WHERE a.street_id IS NOT NULL ORDER BY a.id', []);
      return rows.map((r) => ({ id: r.id, streetId: r.street_id, hoodId: r.hood_id, districtId: r.district_id, point: [r.lon / 1e6, r.lat / 1e6] as LngLat, number: r.number, street: r.name }));
    },
    close: async () => {
      await db.close();
      await b2?.close();
    },
  };
}

const placeOf = (region: Region, door: Door, plate: string, entrance?: LngLat): Place => ({ id: `${plate}:a:${door.id}`, label: '', components: { street: door.street, ...hoodNames(region, door) }, coordinate: door.point, precision: 'address', approximate: false, source: 'osm', confidence: 1, region: plate, ...(entrance ? { entrance } : {}) });

const hoodNames = (region: Region, door: Door): { neighbourhood?: string; district?: string } => {
  const hood = region.hoods.find((h) => h.id === door.hoodId);
  const district = region.districts.find((d) => d.id === door.districtId);
  return { ...(hood ? { neighbourhood: hood.name } : {}), ...(district ? { district: district.name } : {}) };
};

const originOf = (door: LngLat, rand: () => number): LngLat => {
  const angle = rand() * 2 * Math.PI;
  const lat = door[1] + (Math.sin(angle) * ORIGIN_M) / M_PER_DEGREE;
  const lng = door[0] + (Math.cos(angle) * ORIGIN_M) / (M_PER_DEGREE * Math.cos((door[1] * Math.PI) / 180));
  return [lng, lat];
};

async function onStreet(region: Region, door: Door, point: LngLat): Promise<boolean> {
  const parts = await region.partsOf(door.streetId);
  const hit = nearestLine(point, parts.flatMap((p) => p.lines));
  return hit !== null && hit.distanceM <= CHAIN_TOL_M;
}

type Row = { plate: string; noGeometry: number; tried: number; hasChain: number; plainOn: number; newOn: number; reachedOn: number; noRoad: number; hard: number; hardFixed: number; failed: number; plainDoorM: number[]; newDoorM: number[] };

async function chainRow(s: Setup): Promise<Row> {
  const rand = rng(SEED + Number(s.plate));
  const doors = shuffle(await s.doorsOf(), rand).slice(0, DOORS * 3);
  const row: Row = { plate: s.plate, noGeometry: 0, tried: 0, hasChain: 0, plainOn: 0, newOn: 0, reachedOn: 0, noRoad: 0, hard: 0, hardFixed: 0, failed: 0, plainDoorM: [], newDoorM: [] };
  for (const door of doors) {
    if (row.tried >= DOORS) break;
    if ((await s.region.partsOf(door.streetId)).length === 0) {
      row.noGeometry++;
      continue;
    }
    const place = placeOf(s.region, door, s.plate);
    const arrive = await arrivalOf(s.region, place);
    const origin = originOf(door.point, rand);
    const plain = await s.router.route(origin, door.point);
    const got = await s.router.route(origin, door.point, { arrive });
    if (!plain.ok || !got.ok) {
      row.failed++;
      continue;
    }
    row.tried++;
    if (!arrive.chain) continue;
    row.hasChain++;
    const plainOn = await onStreet(s.region, door, plain.to);
    const newOn = await onStreet(s.region, door, got.to);
    if (plainOn) row.plainOn++;
    if (newOn) row.newOn++;
    if (got.arrival && !got.arrival.onChain) row.noRoad++;
    else if (newOn) row.reachedOn++;
    if (!plainOn) {
      row.hard++;
      if (newOn) row.hardFixed++;
    }
    row.plainDoorM.push(distanceM(plain.to, door.point));
    row.newDoorM.push(distanceM(got.to, door.point));
  }
  return row;
}

async function checkChain(): Promise<Measured> {
  const rows: Row[] = [];
  for (const plate of PLATES) {
    const s = await setup(plate);
    if (!s) continue;
    rows.push(await chainRow(s));
    await s.close();
  }
  const sum = (key: keyof Omit<Row, 'plate' | 'plainDoorM' | 'newDoorM'>): number => rows.reduce((total, r) => total + r[key], 0);
  const hasChain = sum('hasChain');
  const reachable = hasChain - sum('noRoad');
  const hard = sum('hard');
  const medianPlain = quantile(rows.flatMap((r) => r.plainDoorM), 0.5);
  const medianNew = quantile(rows.flatMap((r) => r.newDoorM), 0.5);
  const reachedOn = sum('reachedOn');
  const share = reachable === 0 ? 0 : reachedOn / reachable;
  const measured = `${rows.length} il, ${sum('tried')} rota (kapıdan ~${ORIGIN_M} m uzaktan; sokağının çizgisi paketsiz ${sum('noGeometry')} kapı sayılmadı): sokak çizgisi bulunan ${hasChain}; çizgide sürülebilir yol olan ${reachable} kapıda doğru zincire varış ${percent(share)} (eski: ${percent(sum('plainOn') / Math.max(1, hasChain))}, tümü ${percent(sum('newOn') / Math.max(1, hasChain))}); eski yöntemin başka sokağa vardığı ${hard} kapının ${sum('hardFixed')}'i düzeldi; kapı-varış mesafesi ortanca ${medianPlain.toFixed(1)} → ${medianNew.toFixed(1)} m`;
  const table = rows.map((r) => `| ${r.plate} | ${r.tried} | ${r.hasChain} | ${percent(r.plainOn / Math.max(1, r.hasChain))} | ${percent(r.newOn / Math.max(1, r.hasChain))} | ${r.noRoad} | ${r.hard} | ${r.hardFixed} | ${quantile(r.plainDoorM, 0.5).toFixed(1)} | ${quantile(r.newDoorM, 0.5).toFixed(1)} |`);
  const report = ['# Rota varışı: doğru zincire varış (gerçek il paketleri)', '', 'Kapı: OSM adres noktası; hedef noktası kapının kendisi. "Doğru zincire varış": rotanın bittiği nokta, kapının sokak zincirinin çizgisine ≤ 10 m. Eski: en yakın yola oturma. Yeni: `arrive` ile sokak zincirine oturma (≤ 150 m).', '', '| İl | Rota | Çizgisi var | Eski doğru | Yeni doğru | Çizgide yol yok | Eski yanlış sokak | Düzelen | Kapı mesafesi eski m | yeni m |', '|---|---|---|---|---|---|---|---|---|---|', ...table, '', measured, ''].join('\n');
  return { check: 'chain', pass: hasChain > 0 && share >= LIMITS.chainOnChain && medianNew - medianPlain <= LIMITS.doorSlackM, measured, report };
}

async function checkEntrance(): Promise<Measured> {
  const lines: string[] = [];
  const before: number[] = [];
  const after: number[] = [];
  let tried = 0;
  let seen = 0;
  for (const plate of PLATES) {
    const s = await setup(plate);
    if (!s || !s.buildings) continue;
    const rand = rng(SEED + 7 + Number(plate));
    const doors = shuffle(await s.doorsOf(), rand);
    let count = 0;
    let found = 0;
    const own: number[] = [];
    const mine: number[] = [];
    for (const door of doors) {
      if (count >= ENTRANCES) break;
      const building = await s.buildings.at(door.point, 20);
      if (!building) continue;
      const entrances = await s.buildings.entrances(building.id);
      const mains = entrances.filter((e) => e.kind === 'main' || e.kind === 'yes');
      const main = entrances.length === 1 ? entrances[0] : mains.length === 1 ? mains[0] : undefined;
      if (!main) continue;
      const origin = originOf(door.point, rand);
      const plain = await s.router.route(origin, door.point);
      const arrive = await s.search.arrival(placeOf(s.region, door, plate));
      const got = await s.router.route(origin, door.point, { arrive });
      if (!plain.ok || !got.ok) continue;
      count++;
      if (arrive.entrance && distanceM(arrive.entrance, main.point) < 1) found++;
      own.push(distanceM(plain.to, main.point));
      mine.push(distanceM(got.to, main.point));
    }
    before.push(...own);
    after.push(...mine);
    tried += count;
    seen += found;
    lines.push(`| ${plate} | ${count} | ${quantile(own, 0.5).toFixed(1)} | ${quantile(mine, 0.5).toFixed(1)} | ${quantile(own, 0.9).toFixed(1)} | ${quantile(mine, 0.9).toFixed(1)} |`);
    await s.close();
  }
  const a = quantile(before, 0.5);
  const b = quantile(after, 0.5);
  const gain = a === 0 ? 0 : (a - b) / a;
  const measured = `girişi tek anlamlı (tek giriş ya da tek ana giriş) olan ${tried} kapı: giriş kendiliğinden doğru seçildi ${percent(seen / Math.max(1, tried))}; varış noktası ile giriş arası ortanca ${a.toFixed(1)} → ${b.toFixed(1)} m (%${(gain * 100).toFixed(0)} yakın), p90 ${quantile(before, 0.9).toFixed(1)} → ${quantile(after, 0.9).toFixed(1)} m`;
  const report = ['# Rota varışı: girişe yaklaşma', '', 'Eski: rota kapı noktasına (bina içi) en yakın yola biter. Yeni: giriş bilinince rota girişin yanındaki sokak zincirine biter. Doğru nokta: binanın OSM ana girişi. Rota yolda biter; yol girişe ne kadar yakınsa o kadar. Bilgi amaçlıdır.', '', '| İl | Kapı | Eski ortanca m | Yeni ortanca m | Eski p90 m | Yeni p90 m |', '|---|---|---|---|---|---|', ...lines, '', measured, ''].join('\n');
  return { check: 'entrance', pass: tried > 0, measured, report };
}

async function checkSpeed(): Promise<Measured> {
  const s = await setup('41');
  if (!s) return { check: 'speed', pass: false, measured: 'il paketi yok', report: '' };
  const rand = rng(SEED + 99);
  const doors = shuffle(await s.doorsOf(), rand).slice(0, 120);
  const plain: number[] = [];
  const arrived: number[] = [];
  for (const door of doors) {
    const origin = originOf(door.point, rand);
    const arrive = await arrivalOf(s.region, placeOf(s.region, door, '41'));
    let t = performance.now();
    await s.router.route(origin, door.point);
    plain.push(performance.now() - t);
    t = performance.now();
    await s.router.route(origin, door.point, { arrive });
    arrived.push(performance.now() - t);
  }
  await s.close();
  const measured = `${doors.length} rota (Kocaeli): eski p50 ${quantile(plain, 0.5).toFixed(2)} ms, p95 ${quantile(plain, 0.95).toFixed(2)} ms; zincirli p50 ${quantile(arrived, 0.5).toFixed(2)} ms, p95 ${quantile(arrived, 0.95).toFixed(2)} ms`;
  return { check: 'speed', pass: doors.length > 0 && quantile(arrived, 0.95) <= LIMITS.speedP95Ms, measured, report: `# Rota varışı: süre\n\n${measured}\n` };
}

export async function runArriveCheck(check: string): Promise<Measured | null> {
  if (check === 'chain') return checkChain();
  if (check === 'entrance') return checkEntrance();
  if (check === 'speed') return checkSpeed();
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--check');
  const check = at >= 0 ? process.argv[at + 1] : undefined;
  (check ? runArriveCheck(check) : Promise.resolve(null)).then((result) => {
    if (!result) {
      console.error(`kullanım: --check ${CHECKS.join('|')}`);
      process.exit(2);
    }
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `faz-15-${result.check}.md`), result.report);
    console.log(JSON.stringify({ check: result.check, pass: result.pass, measured: result.measured }));
    process.exit(result.pass ? 0 : 1);
  });
}
