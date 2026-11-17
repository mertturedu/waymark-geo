import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decodeLines } from '../src/core/region/geom';
import { repoRoot } from './addr-sets';

const packs = join(repoRoot, 'dist', 'work', '261028', 'packs');
const MIN_NUMBERS = 3;
const MIN_RHO = 0.8;
const MIN_LENGTH_M = 40;
const PARALLEL = 0.7;

type Vec = [number, number];
type Field = { key: string; name: string; district: number; at: Vec; axis: Vec; dir: 1 | -1; n: number; source: 'osm' | 'rehber'; doors: { num: number; at: Vec }[] };
type DoorRow = { skey: string; d: number; h: number | null; num: number; lon: number; lat: number };
const DOORS = "SELECT s.key || '~' || COALESCE(s.kind, '') AS skey, a.district_id AS d, a.hood_id AS h, a.num AS num, a.lon AS lon, a.lat AS lat FROM address a JOIN street_name s ON s.id = a.street_id WHERE a.num IS NOT NULL";

const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1];

function axisOf(points: Vec[]): { axis: Vec; centre: Vec; length: number } {
  const centre: Vec = [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const p of points) {
    const x = p[0] - centre[0];
    const y = p[1] - centre[1];
    xx += x * x;
    xy += x * y;
    yy += y * y;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const axis: Vec = [Math.cos(angle), Math.sin(angle)];
  const along = points.map((p) => dot([p[0] - centre[0], p[1] - centre[1]], axis));
  return { axis, centre, length: Math.max(...along) - Math.min(...along) };
}

function rank(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    for (let k = i; k <= j; k++) out[order[k]![1]] = (i + j) / 2;
    i = j + 1;
  }
  return out;
}

function rho(a: number[], b: number[]): number {
  const ra = rank(a);
  const rb = rank(b);
  const mean = (ra.length - 1) / 2;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < ra.length; i++) {
    ab += (ra[i]! - mean) * (rb[i]! - mean);
    aa += (ra[i]! - mean) ** 2;
    bb += (rb[i]! - mean) ** 2;
  }
  return aa === 0 || bb === 0 ? 0 : ab / Math.sqrt(aa * bb);
}

function fields(file: string, source: Field['source'], project: (lon: number, lat: number) => Vec): Field[] {
  const db = new DatabaseSync(file, { readOnly: true });
  const groups = new Map<string, DoorRow[]>();
  for (const r of db.prepare(DOORS).all() as DoorRow[]) {
    const key = `${r.d}|${r.h}|${r.skey}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  db.close();
  const out: Field[] = [];
  for (const [key, list] of groups) {
    const unique = [...new Map(list.map((r) => [r.num, r])).values()];
    if (unique.length < MIN_NUMBERS) continue;
    const points = unique.map((r) => project(r.lon / 1e6, r.lat / 1e6));
    const { axis, centre, length } = axisOf(points);
    if (length < MIN_LENGTH_M) continue;
    const r = rho(points.map((p) => dot([p[0] - centre[0], p[1] - centre[1]], axis)), unique.map((u) => u.num));
    if (Math.abs(r) < MIN_RHO) continue;
    out.push({ key, name: list[0]!.skey, district: list[0]!.d, at: centre, axis, dir: r > 0 ? 1 : -1, n: unique.length, source, doors: unique.map((u, i) => ({ num: u.num, at: points[i]! })) });
  }
  return out;
}

type Tally = { asked: number; answered: number; right: number };
const blank = (): Tally => ({ asked: 0, answered: 0, right: 0 });
const show = (t: Tally): string => `%${((100 * t.answered) / Math.max(1, t.asked)).toFixed(0)} / %${((100 * t.right) / Math.max(1, t.answered)).toFixed(1)}`;

const vote = { k: 0, weight: 0, agree: 0 };
const STRICT: [string, (v: typeof vote) => boolean][] = [
  ['uyum ≥ 0,8, komşu ≥ 2', (v) => v.agree >= 0.8 && v.k >= 2],
  ['uyum ≥ 0,9, komşu ≥ 3', (v) => v.agree >= 0.9 && v.k >= 3],
  ['uyum = 1, komşu ≥ 3', (v) => v.agree >= 0.999 && v.k >= 3],
  ['uyum = 1, komşu ≥ 5', (v) => v.agree >= 0.999 && v.k >= 5],
];
const strict = new Map<string, Tally>();
let bareSure = 0;
const metres = { centre: [] as number[], known: [] as number[], sure: [] as number[], sureCentre: [] as number[] };
const mid = (list: number[], q = 0.5): number => Math.round([...list].sort((a, b) => a - b)[Math.floor(q * list.length)] ?? NaN);

function main(): void {
  const plates = process.argv.slice(2);
  const radii = [150, 300, 600];
  const sources: (Field['source'] | 'ikisi')[] = ['osm', 'rehber', 'ikisi'];
  const total = new Map<string, Tally>();
  const lines = [`| İl | Sınanan sokak | ${sources.flatMap((s) => radii.map((r) => `${s} ${r} m`)).join(' | ')} | Kapısız sokak | Komşusu olan (ikisi, 300 m) |`, `|---|---|${sources.flatMap(() => radii.map(() => '---')).join('|')}|---|---|`];
  for (const plate of plates) {
    const address = new DatabaseSync(join(packs, plate, 'address.sqlite'), { readOnly: true });
    const centre = address.prepare('SELECT avg(cx) AS x, avg(cy) AS y FROM district').get() as { x: number; y: number };
    const lat0 = centre.y / 1e6;
    const lon0 = centre.x / 1e6;
    const project = (lon: number, lat: number): Vec => [(lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180), (lat - lat0) * 110540];
    const osm = fields(join(packs, plate, 'address.sqlite'), 'osm', project);
    const listed = fields(join(packs, plate, 'directory.sqlite'), 'rehber', project);
    const all = [...osm, ...listed];
    const cell = 600;
    const grid = new Map<string, Field[]>();
    for (const f of all) {
      const k = `${Math.floor(f.at[0] / cell)}:${Math.floor(f.at[1] / cell)}`;
      grid.set(k, [...(grid.get(k) ?? []), f]);
    }
    const near = (at: Vec, radius: number): { f: Field; d: number }[] => {
      const out: { f: Field; d: number }[] = [];
      const cx = Math.floor(at[0] / cell);
      const cy = Math.floor(at[1] / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const f of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
        const d = Math.hypot(f.at[0] - at[0], f.at[1] - at[1]);
        if (d <= radius) out.push({ f, d });
      }
      return out;
    };
    const guess = (target: { at: Vec; axis: Vec; name: string; district: number; key?: string }, radius: number, source: Field['source'] | 'ikisi'): number => {
      let sum = 0;
      vote.k = 0;
      vote.weight = 0;
      for (const { f, d } of near(target.at, radius)) {
        if (f.key === target.key || (f.name === target.name && f.district === target.district)) continue;
        if (source !== 'ikisi' && f.source !== source) continue;
        const cos = dot(f.axis, target.axis);
        if (Math.abs(cos) < PARALLEL) continue;
        sum += (f.dir * cos * Math.min(f.n, 10)) / (30 + d);
        vote.k += 1;
        vote.weight += (Math.abs(cos) * Math.min(f.n, 10)) / (30 + d);
      }
      vote.agree = vote.weight === 0 ? 0 : Math.abs(sum) / vote.weight;
      return sum;
    };
    for (const target of osm) {
      const g = guess(target, 300, 'ikisi');
      for (const [name, ok] of STRICT) {
        const t = strict.get(name) ?? blank();
        t.asked += 1;
        if (g !== 0 && ok(vote)) {
          t.answered += 1;
          if (Math.sign(g) === target.dir) t.right += 1;
        }
        strict.set(name, t);
      }
    }
    const shapes = new Map<string, Vec[]>();
    for (const part of address.prepare("SELECT p.district_id AS d, p.hood_id AS h, s.key || '~' || COALESCE(s.kind, '') AS skey, p.geom AS geom FROM street_part p JOIN street_name s ON s.id = p.name_id WHERE p.src = 0").all() as { d: number; h: number | null; skey: string; geom: Uint8Array }[]) {
      const key = `${part.d}|${part.h}|${part.skey}`;
      const list = shapes.get(key) ?? [];
      for (const p of (decodeLines(part.geom) as [number, number][][]).flat()) list.push(project(p[0], p[1]));
      shapes.set(key, list);
    }
    const spans = osm.map((f) => {
      const along = (shapes.get(f.key) ?? []).map((p) => dot([p[0] - f.at[0], p[1] - f.at[1]], f.axis));
      return along.length < 2 ? null : { min: Math.min(...along), max: Math.max(...along) };
    });
    const steps: number[] = [];
    osm.forEach((f, i) => {
      const span = spans[i];
      const top = Math.max(...f.doors.map((d) => d.num));
      if (span && top >= 6) steps.push((span.max - span.min) / (top / 2));
    });
    const step = steps.sort((a, b) => a - b)[Math.floor(steps.length / 2)] ?? 20;
    osm.forEach((f, i) => {
      const span = spans[i];
      if (!span || span.max - span.min < MIN_LENGTH_M) return;
      const g = guess(f, 300, 'ikisi');
      const sure = g !== 0 && vote.agree >= 0.8 && vote.k >= 2;
      const place = (dir: number, num: number): number => {
        const start = dir > 0 ? span.min : span.max;
        return Math.min(span.max, Math.max(span.min, start + dir * (Math.ceil(num / 2) - 0.5) * step));
      };
      for (const door of f.doors) {
        const truth = dot([door.at[0] - f.at[0], door.at[1] - f.at[1]], f.axis);
        metres.centre.push(Math.abs((span.min + span.max) / 2 - truth));
        metres.known.push(Math.abs(place(f.dir, door.num) - truth));
        if (sure) {
          metres.sureCentre.push(Math.abs((span.min + span.max) / 2 - truth));
          metres.sure.push(Math.abs(place(Math.sign(g), door.num) - truth));
        }
      }
    });
    const cells: string[] = [];
    for (const source of sources) for (const radius of radii) {
      const t = blank();
      for (const target of osm) {
        t.asked += 1;
        const g = guess(target, radius, source);
        if (g === 0) continue;
        t.answered += 1;
        if (Math.sign(g) === target.dir) t.right += 1;
      }
      cells.push(show(t));
      const key = `${source}|${radius}`;
      const sumT = total.get(key) ?? blank();
      sumT.asked += t.asked;
      sumT.answered += t.answered;
      sumT.right += t.right;
      total.set(key, sumT);
    }
    const withDoors = new Set((address.prepare('SELECT DISTINCT street_id AS s FROM address WHERE street_id IS NOT NULL').all() as { s: number }[]).map((r) => r.s));
    const names = new Map((address.prepare("SELECT id, key || '~' || COALESCE(kind, '') AS k FROM street_name").all() as { id: number; k: string }[]).map((r) => [r.id, r.k]));
    let bare = 0;
    let covered = 0;
    for (const part of address.prepare('SELECT name_id, district_id, geom FROM street_part WHERE src = 0').all() as { name_id: number; district_id: number; geom: Uint8Array }[]) {
      if (withDoors.has(part.name_id)) continue;
      const points = (decodeLines(part.geom) as [number, number][][]).flat().map((p) => project(p[0], p[1]));
      if (points.length < 2) continue;
      const { axis, centre: at, length } = axisOf(points);
      if (length < MIN_LENGTH_M) continue;
      bare += 1;
      if (guess({ at, axis, name: names.get(part.name_id) ?? '', district: part.district_id }, 300, 'ikisi') !== 0) {
        covered += 1;
        if (vote.agree >= 0.8 && vote.k >= 2) bareSure += 1;
      }
    }
    address.close();
    const tb = total.get('bare') ?? blank();
    tb.asked += bare;
    tb.answered += covered;
    total.set('bare', tb);
    lines.push(`| ${plate} | ${osm.length} | ${cells.join(' | ')} | ${bare} | %${((100 * covered) / Math.max(1, bare)).toFixed(1)} |`);
    console.log(lines[lines.length - 1]);
  }
  const tb = total.get('bare') ?? blank();
  lines.push(`| Toplam | | ${sources.flatMap((s) => radii.map((r) => show(total.get(`${s}|${r}`) ?? blank()))).join(' | ')} | ${tb.asked} | %${((100 * tb.answered) / Math.max(1, tb.asked)).toFixed(1)} |`);
  for (const [name, t] of strict) console.log(`Sıkı kural (ikisi, 300 m) ${name}: ${show(t)} (${t.answered} sokak)`);
  console.log(`Sokak boyunca hata, ortanca / %90: sokak ortası ${mid(metres.centre)} / ${mid(metres.centre, 0.9)} m; yön doğru bilinse ${mid(metres.known)} / ${mid(metres.known, 0.9)} m (${metres.centre.length} kapı)`);
  console.log(`Sıkı kuralın cevap verdiği sokaklarda: sokak ortası ${mid(metres.sureCentre)} / ${mid(metres.sureCentre, 0.9)} m; tahmin edilen yönle ${mid(metres.sure)} / ${mid(metres.sure, 0.9)} m (${metres.sure.length} kapı)`);
  console.log(`Kapısız sokaklarda sıkı kural (uyum ≥ 0,8, komşu ≥ 2) cevap verir: ${bareSure} / ${tb.asked} (%${((100 * bareSure) / Math.max(1, tb.asked)).toFixed(1)})`);
  console.log(`\nHücre: cevap verilen sokak oranı / cevap verilenlerde yön doğru oranı.\n\n${lines.join('\n')}`);
}

main();
