import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openBuildings2 } from '../src/core/address/buildings2';
import { openSqlite } from '../src/node/sqlite';
import { lineFromDoors } from '../pipeline/build/address-pack';
import { streetSid } from '../pipeline/build/sid';
import { decodeLines } from '../src/core/region/geom';
import { OPTIONS, deriveNames, validate, type Business, type NamedPart, type Way } from '../pipeline/build/street-names';
import { pick, repoRoot, seeded } from './addr-sets';
import { loadPlate } from './build-street-names';

type Measured = { check: string; pass: boolean; measured: string };

const packs = join(repoRoot, 'dist', 'work', '261028', 'packs');
const PLATES = Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
const pct = (a: number, b: number): string => (b === 0 ? '-' : `%${((a / b) * 100).toFixed(1)}`);
const open = (file: string): DatabaseSync => new DatabaseSync(file, { readOnly: true });
const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

const M = 111_320;
function distToLine(lon: number, lat: number, line: [number, number][]): number {
  let best = Infinity;
  const k = M * Math.cos((lat * Math.PI) / 180);
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as [number, number];
    const b = line[i] as [number, number];
    const ax = (a[0] - lon) * k;
    const ay = (a[1] - lat) * M;
    const dx = (b[0] - a[0]) * k;
    const dy = (b[1] - a[1]) * M;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

async function linksCheck(plates: string[]): Promise<Measured> {
  let total = 0;
  let named = 0;
  let road = 0;
  let inside = 0;
  let right = 0;
  let rightTop3 = 0;
  for (const plate of plates) {
    const file = join(packs, plate, 'buildings2.sqlite');
    if (!existsSync(file)) continue;
    const db = open(file);
    const row = db.prepare('SELECT COUNT(*) n, COUNT(chain) c, SUM(chain IS NULL AND road IS NOT NULL) r FROM building').get() as { n: number; c: number; r: number };
    total += row.n;
    named += row.c;
    road += row.r ?? 0;
    db.close();
    const sql = openSqlite(file);
    const reader = await openBuildings2(sql);
    const address = open(join(packs, plate, 'address.sqlite'));
    const keys = new Map((address.prepare('SELECT id, key FROM street_name').all() as { id: number; key: string }[]).map((r) => [r.id, r.key]));
    const doors = address.prepare('SELECT street_id, lon, lat FROM address WHERE street_id IS NOT NULL ORDER BY id').all() as { street_id: number; lon: number; lat: number }[];
    const step = Math.max(1, Math.floor(doors.length / 300));
    for (let i = 0; i < doors.length; i += step) {
      const d = doors[i] as { street_id: number; lon: number; lat: number };
      const b = await reader.at([d.lon / 1e6, d.lat / 1e6], 6);
      if (!b || b.chain === null) continue;
      inside += 1;
      const want = keys.get(d.street_id);
      if (keys.get(b.chain) === want) right += 1;
      if ([b.chain, b.secondChain, b.thirdChain].some((c) => c !== null && keys.get(c) === want)) rightTop3 += 1;
    }
    address.close();
    await sql.close();
  }
  const wanted = process.argv.includes('--accuracy');
  const pass = wanted ? right / Math.max(1, inside) >= 0.9 : total > 0 && (named + road) / total >= 0.85;
  return { check: 'links', pass, measured: `bina ${total}: adlı sokağa bağlı ${pct(named, total)}, adsız yola bağlı ${pct(road, total)}, toplam ${pct(named + road, total)}; kapının içinde ya da 6 m yakınındaki adlı bağlı binada sokak kapıyla aynı: ${pct(right, inside)} (ilk 3 sokaktan biri ${pct(rightTop3, inside)}; ${inside} kapı)` };
}

function linesCheck(plates: string[]): Measured {
  let derived = 0;
  let missing = 0;
  const offsets: number[] = [];
  let tried = 0;
  for (const plate of plates) {
    const db = open(join(packs, plate, 'address.sqlite'));
    derived += (db.prepare('SELECT COUNT(*) n FROM street_part WHERE src = 1').get() as { n: number }).n;
    missing += (db.prepare('SELECT COUNT(*) n FROM street_name n WHERE NOT EXISTS (SELECT 1 FROM street_part p WHERE p.name_id = n.id)').get() as { n: number }).n;
    const streets = db.prepare('SELECT DISTINCT name_id AS id FROM street_part WHERE src = 0 ORDER BY id').all() as { id: number }[];
    const doorsOf = db.prepare('SELECT lon, lat FROM address WHERE street_id = ? AND district_id = ?');
    const partsOf = db.prepare('SELECT district_id, geom FROM street_part WHERE name_id = ? AND src = 0');
    for (const s of streets.filter((_, i) => i % 7 === 0)) {
      const parts = partsOf.all(s.id) as { district_id: number; geom: Uint8Array }[];
      if (parts.length !== 1) continue;
      const doors = (doorsOf.all(s.id, (parts[0] as { district_id: number }).district_id) as { lon: number; lat: number }[]).map((r) => ({ lon: r.lon / 1e6, lat: r.lat / 1e6 }));
      const line = lineFromDoors(doors);
      if (!line) continue;
      tried += 1;
      const truth = decodeLines((parts[0] as { geom: Uint8Array }).geom).flat() as [number, number][];
      for (let t = 0; t <= 10; t++) {
        const lon = (line[0] as [number, number])[0] + (((line[1] as [number, number])[0] - (line[0] as [number, number])[0]) * t) / 10;
        const lat = (line[0] as [number, number])[1] + (((line[1] as [number, number])[1] - (line[0] as [number, number])[1]) * t) / 10;
        offsets.push(distToLine(lon, lat, truth));
      }
    }
    db.close();
  }
  const p50 = quantile(offsets, 0.5);
  const p90 = quantile(offsets, 0.9);
  return { check: 'lines', pass: derived > 0 && tried > 0 && p90 <= 60, measured: `çizgisi türetilen sokak parçası ${derived}; hâlâ çizgisiz sokak ${missing}; gizlenen gerçek çizgilerde (${tried} sokak) türetilen çizginin gerçeğe uzaklığı ortanca ${p50.toFixed(0)} m, p90 ${p90.toFixed(0)} m` };
}

function idsCheck(plates: string[]): Measured {
  let total = 0;
  let bad = 0;
  for (const plate of plates) {
    const db = open(join(packs, plate, 'address.sqlite'));
    const seen = new Set<string>();
    for (const r of db.prepare('SELECT key, kind, sid FROM street_name').all() as { key: string; kind: string | null; sid: string | null }[]) {
      total += 1;
      if (r.sid === null || seen.has(r.sid) || r.sid !== streetSid(plate, r.key, r.kind)) bad += 1;
      if (r.sid) seen.add(r.sid);
    }
    db.close();
  }
  return { check: 'ids', pass: total > 0 && bad === 0, measured: `${total} sokakta kimlik ad, tür ve ile göre yeniden hesaplanınca farklı/yinelenen/boş ${bad}` };
}

function namesCheck(plates: string[]): Measured {
  const work = join(repoRoot, 'dist', 'work', '261028');
  let proposed = 0;
  let correct = 0;
  let derived = 0;
  let unnamed = 0;
  let baseDerived = 0;
  for (const plate of plates) {
    const { named, unnamed: ways, businesses } = loadPlate(plate);
    const doors: Business[] = readFileSync(join(work, 'addresses', plate, 'addresses.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string; street: string | null; number: string | null; lon: number; lat: number }).filter((r) => r.street && r.number).map((r) => ({ id: `d${r.id}`, name: `d${r.id}`, brand: null, lon: r.lon, lat: r.lat, addr: `${r.street} ${r.number}` }));
    const evidence = [...businesses, ...doors];
    const options = OPTIONS;
    const parts: NamedPart[] = named.map((r) => ({ name: r.name, lines: r.lines }));
    const rng = seeded(4040);
    const sample = Array.from({ length: Math.min(3000, named.length) }, () => pick(rng, named)).map((r) => ({ part: { name: r.name, lines: r.lines } as NamedPart, way: { id: r.ways[0] as string, lines: r.lines } as Way }));
    const v = validate(sample, evidence, parts, options);
    proposed += v.proposed;
    correct += v.correct;
    derived += deriveNames(ways, evidence, parts, options).length;
    baseDerived += deriveNames(ways, businesses, parts).length;
    unnamed += ways.length;
  }
  const precision = proposed === 0 ? 1 : correct / proposed;
  return { check: 'names', pass: precision >= 0.95 && derived > baseDerived, measured: `${plates.length} il, adsız yol ${unnamed}: ad verilen ${derived} (yalnız işletmeyle ${baseDerived}); gizlenen adlı yollarda kesinlik %${(precision * 100).toFixed(1)} (${correct}/${proposed})` };
}

const check = process.argv.find((a) => a.startsWith('--check='))?.slice(8) ?? 'links';
const arg = process.argv.find((a) => a.startsWith('--plates='))?.slice(9);
const plates = arg ? arg.split(',') : PLATES;
(async () => console.log(JSON.stringify(check === 'links' ? await linksCheck(plates) : check === 'lines' ? linesCheck(plates) : check === 'names' ? namesCheck(arg ? plates : ['16', '06', '35', '41']) : idsCheck(plates))))();
