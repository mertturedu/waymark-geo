import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openRegion } from '../src/core/address/pack';
import { firstContaining } from '../src/core/address/reverse';
import { createSearch } from '../src/core/address/search';
import type { Place } from '../src/core/address/types';
import type { LngLat } from '../src/core/geo/cells';
import { distanceM } from '../src/core/geo/distance';
import type { PackStore, SqlDb } from '../src/core/ports';
import { embeddedBorders } from '../src/core/region/embedded';
import { openSqlite } from '../src/node/sqlite';
import { rng, shuffle } from '../test/sim/random';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const CHECKS = ['names'];
export const PLATES = ['34', '06', '35', '41', '16'];
export const LIMITS = { hitAt3: 0.9, gain: 0.3 };
const WORK = join(repoRoot, 'dist', 'work', '261028', 'packs');
const PER_PLATE = 120;
const SAME_M = 120;
const SEED = 1616;

export type Measured = { check: string; pass: boolean; measured: string; report: string };

const percent = (share: number): string => `%${(share * 100).toFixed(1)}`;

type Named = { key: string; name: string; point: LngLat };

const typo = (text: string, rand: () => number): string => {
  const letters = [...text].map((c, i) => ({ c, i })).filter((x) => /\p{L}/u.test(x.c) && x.i > 0 && x.i < text.length - 1);
  const at = letters[Math.floor(rand() * letters.length)];
  return at ? text.slice(0, at.i) + text.slice(at.i + 1) : text;
};

const topOf = (result: Awaited<ReturnType<ReturnType<typeof createSearch>['resolve']>>): Place[] => (result.status === 'resolved' ? [result.best, ...result.candidates] : result.status === 'ambiguous' ? result.candidates : []);

async function run(plate: string): Promise<{ n: number; exact: number[]; typo: number[]; base: number[] } | null> {
  const dir = join(WORK, plate);
  if (!existsSync(join(dir, 'address.sqlite')) || !existsSync(join(dir, 'buildings2.sqlite'))) return null;
  const handles: SqlDb[] = [];
  const open = (file: string): SqlDb | null => {
    if (!existsSync(file)) return null;
    const db = openSqlite(file);
    handles.push(db);
    return db;
  };
  const address = open(join(dir, 'address.sqlite')) as SqlDb;
  const directory = open(join(dir, 'directory.sqlite'));
  const buildings = open(join(dir, 'buildings2.sqlite')) as SqlDb;
  const store = (withNames: boolean): PackStore => ({ installed: async () => [plate], open: async () => address, openPart: async (_: string, kind: string) => (kind === 'directory' ? directory : kind === 'buildings2' && withNames ? buildings : null) });
  try {
    const region = await openRegion(address);
    const polygons = await region.districtPolygons();
    const rows = await buildings.all<{ key: string; name: string; lon: number; lat: number }>('SELECT n.key AS key, b.name AS name, b.lon AS lon, b.lat AS lat FROM building_name n JOIN building b ON b.id = n.id ORDER BY n.key, n.id');
    const seen = new Set<string>();
    const named: Named[] = [];
    for (const r of rows) {
      if (!r.key.includes(' ') || seen.has(r.key)) continue;
      seen.add(r.key);
      named.push({ key: r.key, name: r.name, point: [r.lon / 1e6, r.lat / 1e6] });
    }
    const rand = rng(SEED + Number(plate));
    const sample = shuffle(named, rand).slice(0, PER_PLATE);
    const withNames = createSearch({ store: store(true), borders: embeddedBorders() });
    const without = createSearch({ store: store(false), borders: embeddedBorders() });
    const rank = async (search: typeof withNames, text: string, point: LngLat): Promise<number> => {
      const found = topOf(await search.resolve(text, { limit: 5 }));
      const at = found.findIndex((p) => distanceM(p.coordinate, point) <= SAME_M);
      return at < 0 ? 99 : at + 1;
    };
    const out = { n: 0, exact: [] as number[], typo: [] as number[], base: [] as number[] };
    for (const item of sample) {
      const districtId = firstContaining(polygons, item.point);
      const district = region.districts.find((d) => d.id === districtId)?.name;
      if (!district) continue;
      const text = `${item.name} ${district}`;
      out.n++;
      const r1 = await rank(withNames, text, item.point);
      if (process.env.NAMES_DEBUG && r1 > 3) console.log('MISS', plate, '|', text);
      out.exact.push(r1);
      out.typo.push(await rank(withNames, `${typo(item.name, rand)} ${district}`, item.point));
      out.base.push(await rank(without, text, item.point));
    }
    return out;
  } finally {
    for (const db of handles) await db.close();
  }
}

const share = (ranks: number[], limit: number): number => (ranks.length === 0 ? 0 : ranks.filter((r) => r <= limit).length / ranks.length);

export async function runNamesCheck(): Promise<Measured> {
  const lines: string[] = [];
  const all = { exact: [] as number[], typo: [] as number[], base: [] as number[] };
  for (const plate of PLATES) {
    const r = await run(plate);
    if (!r) continue;
    all.exact.push(...r.exact);
    all.typo.push(...r.typo);
    all.base.push(...r.base);
    lines.push(`| ${plate} | ${r.n} | ${percent(share(r.base, 1))} | ${percent(share(r.base, 3))} | ${percent(share(r.exact, 1))} | ${percent(share(r.exact, 3))} | ${percent(share(r.typo, 3))} |`);
  }
  const measured = `${all.exact.length} adlı bina (5 il, "ad + ilçe"): ilk sırada ${percent(share(all.base, 1))} → ${percent(share(all.exact, 1))}, ilk üçte ${percent(share(all.base, 3))} → ${percent(share(all.exact, 3))}; bir harfi eksik yazılınca ilk üçte ${percent(share(all.typo, 3))}`;
  const report = ['# Bina adıyla arama', '', 'Her ilde adı olan (en az iki sözcük) 120 bina; metin "ad ilçe". Doğru: ilk beşte, binaya ≤ 120 m bir sonuç. "Önce": bina ad tablosu olmadan (adres + rehber paketi).', '', '| İl | Bina | Önce ilk 1 | Önce ilk 3 | Sonra ilk 1 | Sonra ilk 3 | Harf eksik, ilk 3 |', '|---|---|---|---|---|---|---|', ...lines, '', measured, ''].join('\n');
  const gain = share(all.exact, 3) - share(all.base, 3);
  return { check: 'names', pass: all.exact.length > 0 && share(all.exact, 3) >= LIMITS.hitAt3 && gain >= LIMITS.gain, measured, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runNamesCheck().then((result) => {
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'adres-bina-adi.md'), result.report);
    console.log(JSON.stringify({ check: result.check, pass: result.pass, measured: result.measured }));
    process.exit(result.pass ? 0 : 1);
  });
}
