import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import type { LngLat } from '../src/core/geo/cells';
import { distanceM } from '../src/core/geo/distance';
import type { StreetHint } from '../src/core/learned/types';
import { wayPoint } from '../src/core/learned/way';
import { nameKey } from '../src/core/text/fold';
import { streetKey } from '../src/core/text/street';
import { repoRoot } from './addr-sets';
import type { StreetWay } from '../src/core/learned/types';
import { attach, roadsOf, wayOf, type Roads } from './hints-attach';
import { knownStreets, partsOf } from './hints-geo';

export type Poi = { point: LngLat; conf: number; number?: number };
export type Derived = { point: LngLat; radiusM: number; n: number };
export type Options = { minPois: number; minConf: number; spreadM: number; keep: number; pad: number; minRadius: number; maxRadius: number };

export const DEFAULTS: Options = { minPois: 1, minConf: 50, spreadM: 1500, keep: 0.8, pad: 150, minRadius: 250, maxRadius: 1500 };

export const MULTI: Options = { ...DEFAULTS, minPois: 2 };
const SINGLE_RADIUS_M = 500;

const packs = join(repoRoot, 'dist', 'work', '261028', 'packs');
const median = (list: number[]): number => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]!;

export function derive(pois: readonly Poi[], options: Options = DEFAULTS): Derived | null {
  const good = pois.filter((p) => p.conf >= options.minConf);
  if (good.length < options.minPois) return null;
  const rough: LngLat = [median(good.map((p) => p.point[0])), median(good.map((p) => p.point[1]))];
  const near = good.filter((p) => distanceM(rough, p.point) <= options.spreadM);
  if (near.length < options.minPois || near.length < options.keep * good.length) return null;
  const centre: LngLat = [near.reduce((s, p) => s + p.point[0], 0) / near.length, near.reduce((s, p) => s + p.point[1], 0) / near.length];
  const far = Math.max(...near.map((p) => distanceM(centre, p.point)));
  return { point: [Math.round(centre[0] * 1e6) / 1e6, Math.round(centre[1] * 1e6) / 1e6], radiusM: near.length === 1 ? SINGLE_RADIUS_M : Math.round(Math.min(options.maxRadius, Math.max(options.minRadius, far + options.pad))), n: near.length };
}

export type Group = { district: string; key: string; names: Map<string, number>; pois: Poi[] };

export function groupsOf(db: DatabaseSync): Map<string, Group> {
  const rows = db.prepare('SELECT p.lon lon, p.lat lat, i.conf conf, i.number num, d.name district, t.text street FROM poi p JOIN poi_info i ON i.id = p.id JOIN info_text t ON t.id = i.street JOIN district d ON d.id = p.district_id').all() as { lon: number; lat: number; conf: number; num: string | null; district: string; street: string }[];
  const out = new Map<string, Group>();
  for (const r of rows) {
    if (r.street.length > 60 || /\d{3,}.*\d{3,}|\bno\b|\bkat\b|\bblok\b/i.test(r.street)) continue;
    const key = streetKey(r.street).key;
    if (key === '') continue;
    const id = `${nameKey(r.district)}|${key}`;
    const g: Group = out.get(id) ?? { district: nameKey(r.district), key, names: new Map(), pois: [] };
    g.names.set(r.street, (g.names.get(r.street) ?? 0) + 1);
    const door = /^(\d{1,5})(?!\d)/.exec(r.num ?? '');
    g.pois.push({ point: [r.lon / 1e6, r.lat / 1e6], conf: r.conf, ...(door ? { number: Number(door[1]) } : {}) });
    out.set(id, g);
  }
  return out;
}

const topName = (names: Map<string, number>): string => [...names.entries()].sort((a, b) => b[1] - a[1])[0]![0];

export function hintOf(pois: readonly Poi[], roads: Roads | null, options: Options = DEFAULTS): { point: LngLat; radiusM: number; n: number; snapped: boolean; way?: StreetWay } | null {
  const d = derive(pois, options);
  if (!d) return null;
  const a = roads ? attach(roads, pois, undefined, (owner) => owner.startsWith('unnamed:')) : null;
  if (!a) return { ...d, snapped: false };
  const way = wayOf(a.lines, pois);
  return { point: a.point, radiusM: a.radiusM, n: d.n, snapped: true, ...(way ? { way } : {}) };
}

export function overtureHints(plate: string, skip: ReadonlySet<string>, options: Options = DEFAULTS, snap = true): StreetHint[] {
  const dir = join(packs, plate);
  if (!existsSync(join(dir, 'directory.sqlite')) || !existsSync(join(dir, 'address.sqlite'))) return [];
  const addr = new DatabaseSync(join(dir, 'address.sqlite'), { readOnly: true });
  const directory = new DatabaseSync(join(dir, 'directory.sqlite'), { readOnly: true });
  try {
    const known = knownStreets(addr);
    const roads = snap ? roadsOf(plate, false) : null;
    const hints: StreetHint[] = [];
    for (const [id, g] of groupsOf(directory)) {
      if (known.byDistrict.has(id) || skip.has(id)) continue;
      const d = hintOf(g.pois, roads, options);
      if (d) hints.push({ district: g.district, name: topName(g.names), point: d.point, radiusM: d.radiusM, sources: Math.min(d.n, 250), ...(d.way ? { way: d.way } : {}) });
    }
    return hints.sort((a, b) => (a.district + a.name < b.district + b.name ? -1 : 1));
  } finally {
    addr.close();
    directory.close();
  }
}

export function mergeOverture(base: readonly StreetHint[], extra: readonly StreetHint[]): { hints: StreetHint[]; added: number; refined: number; conflicts: number } {
  const id = (h: StreetHint): string => `${h.district}|${streetKey(h.name).key}`;
  const out = new Map(base.map((h) => [id(h), h]));
  let added = 0;
  let refined = 0;
  let conflicts = 0;
  for (const e of extra) {
    const b = out.get(id(e));
    if (!b) {
      out.set(id(e), e);
      added++;
    } else if (distanceM(e.point, b.point) <= b.radiusM) {
      out.set(id(e), { ...e, sources: Math.max(e.sources, b.sources) });
      refined++;
    } else conflicts++;
  }
  return { hints: [...out.values()].sort((a, b) => (a.district + a.name < b.district + b.name ? -1 : 1)), added, refined, conflicts };
}

export type Evaluation = { plate: string; streets: number; hit: number; holdout: number; holdoutIn: number; errors: number[]; gaps: number[]; radii: number[]; snap: { n: number; plainErr: number[]; snapErr: number[]; plainIn: number; snapIn: number; plainR: number[]; snapR: number[] }; door: { base: number[]; line: number[] } };

export function evaluatePlate(plate: string, options: Options = MULTI): Evaluation | null {
  const dir = join(packs, plate);
  if (!existsSync(join(dir, 'directory.sqlite')) || !existsSync(join(dir, 'address.sqlite'))) return null;
  const addr = new DatabaseSync(join(dir, 'address.sqlite'), { readOnly: true });
  const directory = new DatabaseSync(join(dir, 'directory.sqlite'), { readOnly: true });
  try {
    const known = knownStreets(addr);
    const parts = partsOf(addr);
    const out: Evaluation = { plate, streets: 0, hit: 0, holdout: 0, holdoutIn: 0, errors: [], gaps: [], radii: [], snap: { n: 0, plainErr: [], snapErr: [], plainIn: 0, snapIn: 0, plainR: [], snapR: [] }, door: { base: [], line: [] } };
    const roads = roadsOf(plate, false);
    for (const [id, g] of groupsOf(directory)) {
      const real = parts.get(id);
      if (known.byDistrict.has(id) && real) {
        const d = derive(g.pois, options);
        if (!d) continue;
        out.streets++;
        const gap = Math.min(...real.flatMap((p) => p.points).map((pt) => distanceM(d.point, pt)));
        if (gap <= d.radiusM) out.hit++;
        out.gaps.push(gap);
        out.radii.push(d.radiusM);
      } else if (!known.byDistrict.has(id) && g.pois.length >= 2 * options.minPois) {
        const train = g.pois.filter((_, i) => i % 2 === 0);
        const test = g.pois.filter((_, i) => i % 2 === 1);
        const d = derive(train, options);
        if (!d) continue;
        const h = hintOf(train, roads, options);
        if (h?.snapped) {
          out.snap.plainR.push(d.radiusM);
          out.snap.snapR.push(h.radiusM);
          if (h.way) for (const t of test) if (t.number !== undefined) {
            const at = wayPoint(h.way, t.number);
            if (at) {
              out.door.base.push(distanceM(h.point, t.point));
              out.door.line.push(distanceM(at, t.point));
            }
          }
          for (const t of test) {
            out.snap.n++;
            const a = distanceM(d.point, t.point);
            const b = distanceM(h.point, t.point);
            out.snap.plainErr.push(a);
            out.snap.snapErr.push(b);
            if (a <= d.radiusM) out.snap.plainIn++;
            if (b <= h.radiusM) out.snap.snapIn++;
          }
        }
        for (const t of test) {
          out.holdout++;
          const err = distanceM(d.point, t.point);
          out.errors.push(err);
          if (err <= d.radiusM) out.holdoutIn++;
        }
      }
    }
    return out;
  } finally {
    addr.close();
    directory.close();
  }
}

const share = (n: number, d: number): string => (d ? `%${((100 * n) / d).toFixed(1)}` : '-');
const pct = (list: number[], p: number): number => (list.length ? [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor((list.length * p) / 100))]! : NaN);

async function main(): Promise<void> {
  const plates = process.argv.slice(2).filter((a) => /^\d{2}$/.test(a));
  const all = plates.length ? plates : Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
  const results = all.map((p) => evaluatePlate(p)).filter((r): r is Evaluation => r !== null);
  const sum = results.reduce((m, r) => ({ streets: m.streets + r.streets, hit: m.hit + r.hit, holdout: m.holdout + r.holdout, holdoutIn: m.holdoutIn + r.holdoutIn }), { streets: 0, hit: 0, holdout: 0, holdoutIn: 0 });
  const errors = results.flatMap((r) => r.errors);
  const snapped = results.reduce((m, r) => ({ n: m.n + r.snap.n, plainIn: m.plainIn + r.snap.plainIn, snapIn: m.snapIn + r.snap.snapIn }), { n: 0, plainIn: 0, snapIn: 0 });
  const plainErr = results.flatMap((r) => r.snap.plainErr);
  const snapErr = results.flatMap((r) => r.snap.snapErr);
  const plainR = results.flatMap((r) => r.snap.plainR);
  const snapR = results.flatMap((r) => r.snap.snapR);
  const doorBase = results.flatMap((r) => r.door.base);
  const doorLine = results.flatMap((r) => r.door.line);
  const gaps = results.flatMap((r) => r.gaps);
  const radii = results.flatMap((r) => r.radii);
  const hints = all.reduce((n, p) => n + overtureHints(p, new Set(), MULTI).length, 0);
  const lines = [
    '# Overture sokak ipucu ölçümü',
    '',
    `Güncelleme: ${new Date().toISOString()}`,
    '',
    `- Çıkarılan ipucu (pakette olmayan sokak): ${hints}`,
    `- Gerçek sokak sınaması (OSM'de olan sokakta ipucu dairesi gerçek sokağı kesiyor mu): ${sum.hit}/${sum.streets} ${share(sum.hit, sum.streets)}`,
    `- Gerçek sokağa uzaklık: ortanca ${Math.round(pct(gaps, 50))} m, %90 ${Math.round(pct(gaps, 90))} m, 250 m içinde ${share(gaps.filter((g) => g <= 250).length, gaps.length)}; yarıçap ortanca ${Math.round(pct(radii, 50))} m`,
    `- Eşli sınama (pakette olmayan sokakta işletmelerin yarısı ile kurulup diğer yarısı sınandı): ${sum.holdoutIn}/${sum.holdout} ${share(sum.holdoutIn, sum.holdout)} yarıçap içinde, ortanca hata ${Math.round(pct(errors, 50))} m, %90 ${Math.round(pct(errors, 90))} m`,
    '',
    `- Adsız yola bağlama (eşli sınama, ${snapped.n} sınama noktası): yarıçap içinde ${share(snapped.plainIn, snapped.n)} → ${share(snapped.snapIn, snapped.n)}, ortanca hata ${Math.round(pct(plainErr, 50))} m → ${Math.round(pct(snapErr, 50))} m, ortanca yarıçap ${Math.round(pct(plainR, 50))} m → ${Math.round(pct(snapR, 50))} m`,
    '',
    `- Kapı numarasından konum (eşli sınama, ${doorLine.length} numaralı işletme): ortanca hata ${Math.round(pct(doorBase, 50))} m → ${Math.round(pct(doorLine, 50))} m, %90 ${Math.round(pct(doorBase, 90))} m → ${Math.round(pct(doorLine, 90))} m, 100 m içinde ${share(doorBase.filter((x) => x <= 100).length, doorBase.length)} → ${share(doorLine.filter((x) => x <= 100).length, doorLine.length)}, 200 m içinde ${share(doorBase.filter((x) => x <= 200).length, doorBase.length)} → ${share(doorLine.filter((x) => x <= 200).length, doorLine.length)}`,
    '',
    '| İl | Sokak (OSM sınaması) | Doğru | Eşli sınama | Yarıçap içinde |',
    '|---|---|---|---|---|',
    ...results.map((r) => `| ${r.plate} | ${r.streets} | ${share(r.hit, r.streets)} | ${r.holdout} | ${share(r.holdoutIn, r.holdout)} |`),
  ];
  writeFileSync(join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'faz-19', 'overture-ipucu.md'), lines.join('\n') + '\n');
  console.log(lines.slice(2, 12).join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
