import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readChains, readDoors } from '../pipeline/build/building-pack2';
import { placeDoors, predictNumbers, type Door } from '../pipeline/build/building-numbers';
import { metres } from '../pipeline/build/building-link';
import { prepare, type OsmBuildingTag, type Trace } from '../pipeline/build/building-pack-v2';
import { streetKey } from '../src/core/text/street';
import { repoRoot } from './addr-sets';
import { rng, shuffle } from '../test/sim/random';

type Measured = { check: string; pass: boolean; measured: string; numbers?: Record<string, number> };

const work = join(repoRoot, 'dist', 'work', '261028');
const packs = join(work, 'packs');
const PLATES = Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
const HIDDEN_PLATES = ['16', '41', '06', '35'];
const HIDE = 0.25;
const pct = (a: number, b: number): string => (b === 0 ? '-' : `%${((a / b) * 100).toFixed(1)}`);
const lines = <T>(path: string): T[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : []);

type Tally = { buildingRight: number; rangeTests: number; rangeIn: number; tests: number; covered: number; exact: number; within2: number; positions: number[]; wrongParity: number };
const fresh = (): Tally => ({ buildingRight: 0, rangeTests: 0, rangeIn: 0, tests: 0, covered: 0, exact: 0, within2: 0, positions: [], wrongParity: 0 });
const median = (v: number[]): number => (v.length === 0 ? 0 : ([...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] as number));

function hiddenCheck(plates: string[]): Measured {
  const by = { osm: fresh(), directory: fresh() };
  for (const plate of plates) {
    const traces = lines<Trace & { height?: number | null; floors?: number | null }>(join(work, 'building-traces', `${plate}.jsonl`)).map((r) => ({ ...r, height: r.height ?? null, floors: r.floors ?? null }));
    const tags = new Map(lines<OsmBuildingTag>(join(work, 'building-tags', 'osm-buildings.jsonl')).map((t) => [t.id, t]));
    const addressFile = join(packs, plate, 'address.sqlite');
    const { chains, doors } = readChains(addressFile);
    const rows = prepare(traces, chains, tags, doors);
    const all = readDoors(addressFile, join(work, 'overture', `${plate}.rows.jsonl`));
    const chainKeys = new Map(chains.map((c) => [c.id, streetKey(c.name).key]));
    const full = placeDoors(rows, all, chainKeys);
    const doorAt = new Map<Door, number>();
    const doorCand = new Map<Door, string>();
    for (const [i, list] of full.anchors) for (const { door, cand } of list) {
      doorAt.set(door, i);
      doorCand.set(door, `${cand.chain}:${cand.component}:${cand.side}`);
    }
    const placedDoors = [...doorAt.keys()];
    const rand = rng(7171 + Number(plate));
    const hidden = new Set(shuffle(placedDoors, rand).slice(0, Math.floor(placedDoors.length * HIDE)));
    const rest = all.filter((d) => !hidden.has(d));
    const placed = placeDoors(rows, rest, chainKeys);
    const out = predictNumbers(rows, placed.anchors);
    const trackOf = (i: number): string => {
      const l = rows[i]?.link;
      return l ? `${l.chain}:${l.component}:${l.side}` : '';
    };
    const rangeOf = new Map(out.ranges.map((r) => [`${r.chain}:${r.component}:${r.side}`, r]));
    const byTrack = new Map<string, number[]>();
    out.numbers.forEach((n, i) => {
      const t = trackOf(i);
      if (t && n && (n.known !== null || n.predicted)) byTrack.set(t, [...(byTrack.get(t) ?? []), i]);
    });
    for (const door of hidden) {
      const i = doorAt.get(door) as number;
      const tally = door.src === 1 ? by.osm : by.directory;
      tally.tests += 1;
      const range = rangeOf.get(doorCand.get(door) as string);
      if (range) {
        tally.rangeTests += 1;
        const low = Math.min(range.min, range.predictedMin ?? range.min);
        const high = Math.max(range.max, range.predictedMax ?? range.max);
        if (door.num >= low - 2 && door.num <= high + 2) tally.rangeIn += 1;
      }
      const n = out.numbers[i];
      if (n?.known) continue;
      const p = n?.predicted;
      if (!p) continue;
      tally.covered += 1;
      if (p.value === door.num) tally.exact += 1;
      if (Math.abs(p.value - door.num) <= 2) tally.within2 += 1;
      if (p.value % 2 !== door.num % 2) tally.wrongParity += 1;
      const mates = byTrack.get(trackOf(i)) ?? [];
      let best = -1;
      let bestDelta = Infinity;
      for (const j of mates) {
        const value = out.numbers[j]?.known ? Number.parseInt(out.numbers[j]?.known as string, 10) : (out.numbers[j]?.predicted?.value ?? NaN);
        const delta = Math.abs(value - door.num);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = j;
        }
      }
      if (best === i) tally.buildingRight += 1;
      if (best >= 0) tally.positions.push(metres([rows[best]?.trace.lon as number, rows[best]?.trace.lat as number], [door.lon, door.lat]));
    }
  }
  const line = (name: string, t: Tally): string => `${name}: gizlenen ${t.tests}, tahmini olan ${pct(t.covered, t.tests)}; tahmini olanlarda tam ${pct(t.exact, t.covered)}, ±2 ${pct(t.within2, t.covered)}, yanlış eşlik ${pct(t.wrongParity, t.covered)}, numarası en yakın binanın konum hatası ortanca ${median(t.positions).toFixed(0)} m; numarası en yakın bina doğru bina ${pct(t.buildingRight, t.covered)}; numara sokak-taraf aralığının içinde ${pct(t.rangeIn, t.rangeTests)} (${t.rangeTests} kapı)`;
  const share = (a: number, b: number): number => (b === 0 ? 0 : a / b);
  return { check: 'hidden', pass: by.osm.covered > 0 && share(by.osm.within2, by.osm.covered) >= 0.85 && median(by.osm.positions) <= 12 && share(by.osm.buildingRight, by.osm.covered) >= 0.7, numbers: { within2: share(by.osm.within2, by.osm.covered), median: median(by.osm.positions), right: share(by.osm.buildingRight, by.osm.covered), range: share(by.osm.rangeIn, by.osm.rangeTests) }, measured: `${plates.length} il, kapıların %25'i gizli; ${line('OSM kapısı', by.osm)}; ${line('rehber kapısı', by.directory)}` };
}

function coverageCheck(plates: string[]): Measured {
  let linked = 0;
  let known = 0;
  let predicted = 0;
  let ranges = 0;
  let total = 0;
  let extrapolated = 0;
  let knownOsm = 0;
  let knownDirectory = 0;
  for (const plate of plates) {
    const file = join(packs, plate, 'buildings2.sqlite');
    if (!existsSync(file)) continue;
    const db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare('SELECT COUNT(*) n, COUNT(chain) c, SUM(num IS NOT NULL) k, SUM(num IS NULL AND pnum IS NOT NULL) p, SUM(pext = 1) e, SUM(nsrc = 1) ko, SUM(nsrc = 2) kd FROM building').get() as { n: number; c: number; k: number; p: number; e: number; ko: number; kd: number };
    knownOsm += row.ko ?? 0;
    knownDirectory += row.kd ?? 0;
    total += row.n;
    linked += row.c;
    known += row.k ?? 0;
    predicted += row.p ?? 0;
    extrapolated += row.e ?? 0;
    ranges += (db.prepare('SELECT COUNT(*) n FROM street_range').get() as { n: number }).n;
    db.close();
  }
  const status = (known + predicted) / Math.max(1, linked);
  return { check: 'coverage', pass: status >= 0.9, numbers: { status, known, predicted, osm: knownOsm, directory: knownDirectory }, measured: `bina ${total}, sokağa bağlı ${linked}: numarası bilinen ${pct(known, linked)} (OSM ${knownOsm}, rehber ${knownDirectory} bina), tahmini ${pct(predicted, linked)} (genişletilmiş ya da karşı taraftan ${pct(extrapolated, predicted)}), numara durumu olan toplam ${pct(known + predicted, linked)}, bilinmeyen ${pct(linked - known - predicted, linked)}; sokak-taraf-parça aralığı ${ranges}` };
}

const check = process.argv.find((a) => a.startsWith('--check='))?.slice(8) ?? 'coverage';
const arg = process.argv.find((a) => a.startsWith('--plates='))?.slice(9);
console.log(JSON.stringify(check === 'hidden' ? hiddenCheck(arg ? arg.split(',') : HIDDEN_PLATES) : coverageCheck(arg ? arg.split(',') : PLATES)));
