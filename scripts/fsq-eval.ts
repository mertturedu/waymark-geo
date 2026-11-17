import { createReadStream, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildDirectoryPack, type DirectoryRow } from '../pipeline/build/directory';
import { distanceM } from '../src/core/geo/distance';
import { createBorders } from '../src/core/region/borders';
import { repoRoot } from './addr-sets';

const root = join(repoRoot, 'dist', 'fsq');
const previous = join(repoRoot, 'dist', 'packs-0.17-apple');
const packs = join(repoRoot, 'dist', 'work', '261028', 'packs');

type Source = { id: string; name: string; addr: string; locality: string | null; postcode: string | null; lon: number; lat: number; cat: string | null };
type Door = { d: number; h: number | null; skey: string; kind: string; nkey: string; lon: number; lat: number };
const DOORS = "SELECT a.district_id AS d, a.hood_id AS h, s.key AS skey, COALESCE(s.kind, '') AS kind, a.nkey AS nkey, a.lon AS lon, a.lat AS lat FROM address a JOIN street_name s ON s.id = a.street_id";
const STREETS = "SELECT DISTINCT p.district_id AS d, s.key AS skey, COALESCE(s.kind, '') AS kind FROM street_part p JOIN street_name s ON s.id = p.name_id";

const quantile = (list: number[], q: number): number => (list.length === 0 ? NaN : [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(q * list.length))]!);
const doorKey = (r: Door): string => `${r.d}|${r.h}|${r.skey}|${r.kind}|${r.nkey}`;
const looseKey = (r: Door): string => `${r.d}|${r.skey}|${r.kind}|${r.nkey}`;
const streetKey = (r: { d: number; skey: string; kind: string }): string => `${r.d}|${r.skey}|${r.kind}`;
const at = (r: Door): [number, number] => [r.lon / 1e6, r.lat / 1e6];

async function split(): Promise<void> {
  const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
  const out = new Map<string, string[]>();
  const take = (line: string): void => {
    if (line === '') return;
    const s = JSON.parse(line) as Source;
    const plate = borders.provinceAt(s.lon, s.lat);
    if (!plate) return;
    const row: DirectoryRow = { id: s.id, name: s.name, name_tr: null, cat: s.cat ?? '', g: 'other', conf: 0.6, addr: s.addr, more: [], locality: s.locality, postcode: s.postcode, lon: s.lon, lat: s.lat };
    const list = out.get(plate) ?? [];
    list.push(JSON.stringify(row));
    out.set(plate, list);
  };
  let rest = '';
  for await (const chunk of createReadStream(join(root, 'tr-addr.jsonl'), { encoding: 'utf8' })) {
    const parts = (rest + (chunk as string)).split('\n');
    rest = parts.pop() ?? '';
    for (const part of parts) take(part);
  }
  take(rest);
  const target = join(repoRoot, 'dist', 'work', '261028', 'fsq');
  mkdirSync(target, { recursive: true });
  for (const [plate, list] of out) writeFileSync(join(target, `${plate}.rows.jsonl`), list.join('\n') + '\n');
  console.log([...out].map(([p, l]) => `${p}:${l.length}`).sort().join(' '));
}

async function build(plates: string[]): Promise<void> {
  const workDir = join(repoRoot, 'dist', 'work', '261028');
  for (const plate of plates) {
    const outFile = join(packs, plate, 'directory.sqlite');
    const before = new DatabaseSync(outFile, { readOnly: true });
    const osmTimestamp = (before.prepare("SELECT v FROM meta WHERE k = 'osm_time'").get() as { v: string }).v;
    before.close();
    const stats = await buildDirectoryPack({ province: plate, workDir, outFile, osmTimestamp });
    writeFileSync(join(packs, plate, 'directory-stats.json'), JSON.stringify(stats));
    console.log(plate, JSON.stringify({ rows: stats.sourceRows, extra: stats.extraRows, doors: stats.doorGroups, places: stats.places, bytes: stats.bytes }));
  }
}

function measure(plates: string[]): void {
  const lines = ['| İl | Yeni rehber kapı | OSM ile eşleşen | Yeni ortanca | Yeni %90 | Eski ortanca | Yeni kapı (OSM ve eski rehberde yok) | Yeni sokak | Yeni sokak ≥2 kapı | Eski rehberle ortak kapı | Aralarındaki ortanca |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  const total = { fsq: 0, newDoors: 0, newStreets: 0, newStreets2: 0, errors: [] as number[], overture: [] as number[], between: [] as number[] };
  for (const plate of plates) {
    const read = <T>(file: string, sql: string): T[] => {
      const db = new DatabaseSync(file, { readOnly: true });
      const rows = db.prepare(sql).all() as T[];
      db.close();
      return rows;
    };
    const osm = read<Door>(join(packs, plate, 'address.sqlite'), DOORS);
    const osmStreets = new Set(read<Door>(join(packs, plate, 'address.sqlite'), STREETS).map(streetKey));
    const old = join(previous, plate, readdirSync(join(previous, plate)).find((f) => /^directory-.*\.sqlite$/.test(f)) as string);
    const ov = read<Door>(old, DOORS);
    const ovStreets = new Set(read<Door>(old, STREETS).map(streetKey));
    const fsq = read<Door>(join(packs, plate, 'directory.sqlite'), DOORS);
    const known = new Map<string, Door[]>();
    for (const r of osm) known.set(doorKey(r), [...(known.get(doorKey(r)) ?? []), r]);
    const nearest = (r: Door, pool: Map<string, Door[]>, key: (d: Door) => string): number | null => {
      const twins = pool.get(key(r));
      return twins ? Math.min(...twins.map((t) => distanceM(at(r), at(t)))) : null;
    };
    const errors = fsq.map((r) => nearest(r, known, doorKey)).filter((v): v is number => v !== null);
    const ovErrors = ov.map((r) => nearest(r, known, doorKey)).filter((v): v is number => v !== null);
    const osmLoose = new Set(osm.map(looseKey));
    const ovLoose = new Map<string, Door[]>();
    for (const r of ov) ovLoose.set(looseKey(r), [...(ovLoose.get(looseKey(r)) ?? []), r]);
    const fresh = fsq.filter((r) => !osmLoose.has(looseKey(r)) && !ovLoose.has(looseKey(r)));
    const between = fsq.map((r) => nearest(r, ovLoose, looseKey)).filter((v): v is number => v !== null);
    const perStreet = new Map<string, number>();
    for (const r of fsq) if (!osmStreets.has(streetKey(r)) && !ovStreets.has(streetKey(r))) perStreet.set(streetKey(r), (perStreet.get(streetKey(r)) ?? 0) + 1);
    const two = [...perStreet.values()].filter((n) => n >= 2).length;
    const m = (v: number): string => (Number.isNaN(v) ? '-' : `${Math.round(v)} m`);
    lines.push(`| ${plate} | ${fsq.length} | ${errors.length} | ${m(quantile(errors, 0.5))} | ${m(quantile(errors, 0.9))} | ${m(quantile(ovErrors, 0.5))} | ${fresh.length} | ${perStreet.size} | ${two} | ${between.length} | ${m(quantile(between, 0.5))} |`);
    total.fsq += fsq.length;
    total.newDoors += fresh.length;
    total.newStreets += perStreet.size;
    total.newStreets2 += two;
    for (const e of errors) total.errors.push(e);
    for (const e of ovErrors) total.overture.push(e);
    for (const e of between) total.between.push(e);
  }
  lines.push(`| Toplam | ${total.fsq} | ${total.errors.length} | ${Math.round(quantile(total.errors, 0.5))} m | ${Math.round(quantile(total.errors, 0.9))} m | ${Math.round(quantile(total.overture, 0.5))} m | ${total.newDoors} | ${total.newStreets} | ${total.newStreets2} | ${total.between.length} | ${Math.round(quantile(total.between, 0.5))} m |`);
  const within = (list: number[], limit: number): string => `%${((100 * list.filter((e) => e <= limit).length) / Math.max(1, list.length)).toFixed(1)}`;
  lines.push('', `Yeni rehber 50 m içinde ${within(total.errors, 50)}, 100 m içinde ${within(total.errors, 100)}; eski rehber 50 m içinde ${within(total.overture, 50)}, 100 m içinde ${within(total.overture, 100)}.`);
  console.log(lines.join('\n'));
  writeFileSync(join(root, 'olcum.md'), lines.join('\n') + '\n');
}

async function main(): Promise<void> {
  const [mode, ...plates] = process.argv.slice(2);
  if (mode === 'split') await split();
  else if (mode === 'build') await build(plates);
  else if (mode === 'measure') measure(plates);
}

void main();
