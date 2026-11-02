import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LngLat } from '../src/core/geo/cells';
import { distanceM } from '../src/core/geo/distance';
import { createSearch } from '../src/core/address/search';
import type { SqlDb } from '../src/core/ports';
import { createBorders } from '../src/core/region/borders';
import { provinceName } from '../src/core/text/admin';
import { createNodePackStore } from '../src/node/pack-store';
import { PRIORITY, repoRoot, type Measured } from './measure-address';
import { percentile } from './measure-quality';

export const MIN_PAIRS = 1000;
export const MEDIAN_MAX_M = 30;
export const P90_MAX_M = 150;
export const ROUNDTRIP_MIN = 90;
export const ROUNDTRIP_RADIUS_M = 100;
export const DOOR_SHARE_MIN = 50;
const PER_PLATE = 100;

type Door = { nkey: string; lon: number; lat: number; d: number; h: number | null; skey: string; kind: string };
const DOORS = "SELECT a.nkey AS nkey, a.lon AS lon, a.lat AS lat, a.district_id AS d, a.hood_id AS h, s.key AS skey, COALESCE(s.kind, '') AS kind FROM address a JOIN street_name s ON s.id = a.street_id ORDER BY a.id";
const keyOf = (r: Door): string => `${r.d}|${r.h}|${r.skey}|${r.kind}|${r.nkey}`;
const fmt = (n: number): string => String(Math.round(n));
const packsDir = join(repoRoot, 'dist', 'packs');

export function pairVerdict(distances: number[]): { pass: boolean; median: number; p90: number } {
  const sorted = [...distances].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const p90 = percentile(sorted, 0.9);
  return { pass: sorted.length >= MIN_PAIRS && median <= MEDIAN_MAX_M && p90 <= P90_MAX_M, median, p90 };
}

export async function measureDirectoryAccuracy(): Promise<Measured> {
  const store = await createNodePackStore(packsDir);
  const lines = ['# Rehber paketi doğruluğu', '', 'Aynı ilçe, mahalle, sokak ve kapı numarasına sahip kapılar için rehber noktasının adres paketindeki noktaya uzaklığı (metre).', '', '| İl | Rehber kapısı | Adres paketi kapısı | Eşleşen | Ortanca | p90 |', '|---|---|---|---|---|---|'];
  const pooled: number[] = [];
  for (const plate of PRIORITY) {
    const osm = (await store.open(plate)) as SqlDb;
    const listing = store.openPart ? await store.openPart(plate, 'directory') : null;
    if (!listing) {
      lines.push(`| ${plate} | rehber yok | | | | |`);
      continue;
    }
    const known = new Map<string, Door[]>();
    const osmDoors = await osm.all<Door>(DOORS);
    for (const r of osmDoors) known.set(keyOf(r), [...(known.get(keyOf(r)) ?? []), r]);
    const listed = await listing.all<Door>(DOORS);
    const distances: number[] = [];
    for (const r of listed) {
      const twins = known.get(keyOf(r));
      if (!twins) continue;
      distances.push(Math.min(...twins.map((t) => distanceM([r.lon / 1e6, r.lat / 1e6], [t.lon / 1e6, t.lat / 1e6]))));
    }
    pooled.push(...distances);
    const sorted = [...distances].sort((a, b) => a - b);
    lines.push(`| ${plate} | ${listed.length} | ${osmDoors.length} | ${distances.length} | ${fmt(percentile(sorted, 0.5))} | ${fmt(percentile(sorted, 0.9))} |`);
    await osm.close();
    await listing.close();
  }
  const verdict = pairVerdict(pooled);
  lines.push('', `Toplam ${pooled.length} eşleşme: ortanca ${fmt(verdict.median)} m, p90 ${fmt(verdict.p90)} m. Eşik: en az ${MIN_PAIRS} eşleşme, ortanca en çok ${MEDIAN_MAX_M} m, p90 en çok ${P90_MAX_M} m.`);
  return { check: 'accuracy', pass: verdict.pass, measured: `${pooled.length} eşleşme, ortanca ${fmt(verdict.median)} m, p90 ${fmt(verdict.p90)} m`, report: lines.join('\n') + '\n' };
}

export function detailVerdict(total: number, withInfo: number, withDoor: number): { pass: boolean; percent: number } {
  const percent = total === 0 ? 0 : (withDoor * 100) / total;
  return { pass: total > 0 && withInfo === total && percent >= DOOR_SHARE_MIN, percent };
}

export async function measureDirectoryDetails(): Promise<Measured> {
  const store = await createNodePackStore(packsDir);
  const lines = ['# Rehber işletme ayrıntıları', '', 'Her ilde rehberdeki işletmeler: ayrıntı satırı olanlar ve kapı numarası bilinenler.', '', '| İl | İşletme | Ayrıntılı | Sokak biliniyor | Kapı numarası biliniyor |', '|---|---|---|---|---|'];
  let total = 0;
  let withInfo = 0;
  let withDoor = 0;
  for (const plate of PRIORITY) {
    const listing = store.openPart ? await store.openPart(plate, 'directory') : null;
    if (!listing) continue;
    const [counts] = await listing.all<{ n: number; info: number; street: number; door: number }>(
      'SELECT COUNT(*) AS n, COUNT(i.id) AS info, SUM(CASE WHEN i.street IS NOT NULL THEN 1 ELSE 0 END) AS street, SUM(CASE WHEN i.number IS NOT NULL THEN 1 ELSE 0 END) AS door FROM poi p LEFT JOIN poi_info i ON i.id = p.id',
    );
    const row = counts as { n: number; info: number; street: number; door: number };
    total += row.n;
    withInfo += row.info;
    withDoor += row.door;
    lines.push(`| ${plate} | ${row.n} | ${row.info} | ${row.street} | ${row.door} |`);
    await listing.close();
  }
  const verdict = detailVerdict(total, withInfo, withDoor);
  lines.push('', `Toplam ${total} işletme, ${withInfo} ayrıntılı, ${withDoor} kapı numaralı (yüzde ${verdict.percent.toFixed(1)}). Eşik: hepsi ayrıntılı, kapı numaralı en az yüzde ${DOOR_SHARE_MIN}.`);
  return { check: 'details', pass: verdict.pass, measured: `${withDoor}/${total} işletmede kapı numarası (yüzde ${verdict.percent.toFixed(1)}), ayrıntısız ${total - withInfo}`, report: lines.join('\n') + '\n' };
}

type Listed = { number: string; street: string; hood: string; district: string; lon: number; lat: number };

export async function measureDirectoryRoundtrip(): Promise<Measured> {
  const store = await createNodePackStore(packsDir);
  const search = createSearch({ store, borders: createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin'))) });
  const lines = ['# Rehber kapıları arama turu', '', `Her ilde rehber kapılarından düzenli aralıkla en çok ${PER_PLATE} tanesi tam adres olarak aratılır; ilk 3 sonuçtan biri ${ROUNDTRIP_RADIUS_M} m içindeyse tuttu sayılır.`, '', '| İl | Sorgu | Tuttu |', '|---|---|---|'];
  let total = 0;
  let hit = 0;
  const missed: string[] = [];
  for (const plate of PRIORITY) {
    const listing = store.openPart ? await store.openPart(plate, 'directory') : null;
    if (!listing) continue;
    const rows = await listing.all<Listed>(
      'SELECT a.number AS number, s.name AS street, h.name AS hood, d.name AS district, a.lon AS lon, a.lat AS lat FROM address a JOIN street_name s ON s.id = a.street_id JOIN neighbourhood h ON h.id = a.hood_id JOIN district d ON d.id = a.district_id ORDER BY a.id',
    );
    const stride = Math.max(1, Math.floor(rows.length / PER_PLATE));
    let asked = 0;
    let ok = 0;
    for (let i = 0; i < rows.length && asked < PER_PLATE; i += stride) {
      const r = rows[i] as Listed;
      const truth: LngLat = [r.lon / 1e6, r.lat / 1e6];
      const text = `${r.hood} Mahallesi ${r.street} No:${r.number} ${r.district}/${provinceName(plate) ?? plate}`;
      const result = await search.resolve(text, { limit: 3 });
      const near = result.status !== 'region_missing' && result.candidates.slice(0, 3).some((c) => distanceM(c.coordinate, truth) <= ROUNDTRIP_RADIUS_M);
      asked += 1;
      if (near) ok += 1;
      else if (missed.length < 40) missed.push(`${plate}: ${text}`);
    }
    total += asked;
    hit += ok;
    lines.push(`| ${plate} | ${asked} | ${ok} |`);
    await listing.close();
  }
  const percent = total === 0 ? 0 : (hit * 100) / total;
  lines.push('', `Toplam ${hit}/${total} (yüzde ${percent.toFixed(1)}). Eşik: en az yüzde ${ROUNDTRIP_MIN}.`, '', '## Tutmayanlar (ilk 40)', '', ...missed.map((m) => `- ${m}`));
  return { check: 'roundtrip', pass: total > 0 && percent >= ROUNDTRIP_MIN, measured: `${hit}/${total} (yüzde ${percent.toFixed(1)})`, report: lines.join('\n') + '\n' };
}

export async function runCheck(check: string): Promise<Measured | null> {
  if (check === 'accuracy') return measureDirectoryAccuracy();
  if (check === 'roundtrip') return measureDirectoryRoundtrip();
  if (check === 'details') return measureDirectoryDetails();
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--check');
  const check = at >= 0 ? process.argv[at + 1] : undefined;
  (check ? runCheck(check) : Promise.resolve(null)).then((result) => {
    if (!result) {
      console.error('kullanım: --check accuracy|roundtrip|details');
      process.exit(2);
    }
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `faz-5-rehber-${result.check}.md`), result.report);
    console.log(JSON.stringify({ check: result.check, pass: result.pass, measured: result.measured }));
    process.exit(result.pass ? 0 : 1);
  });
}
