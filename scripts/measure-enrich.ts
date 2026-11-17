import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSearch, type Search } from '../src/core/address/search';
import { distanceM } from '../src/core/geo/distance';
import type { LngLat } from '../src/core/geo/cells';
import type { PackStore, SqlDb } from '../src/core/ports';
import { embeddedBorders } from '../src/core/region/embedded';
import { buildDirectoryPack } from '../pipeline/build/directory';
import { openRegion } from '../src/core/address/pack';
import { openSqlite } from '../src/node/sqlite';
import { rng, shuffle } from '../test/sim/random';
import { readSet, type TextRecord } from './addr-sets';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const WORK = join(repoRoot, 'dist', 'work', '261028', 'packs');
export const PLATES = ['34', '06', '35', '41', '16'];
const DISTRICTS = 8;
const TEXTS = 300;

export type Measured = { check: string; pass: boolean; measured: string; report: string };

async function plainDirectory(plate: string): Promise<string | null> {
  const rows = join(WORK, '..', 'overture', `${plate}.rows.jsonl`);
  const admin = join(WORK, '..', 'admin-pack', `${plate}.jsonl`);
  if (!existsSync(rows) || !existsSync(admin)) return null;
  const dir = mkdtempSync(join(tmpdir(), 'enrich-'));
  mkdirSync(join(dir, 'admin-pack'), { recursive: true });
  mkdirSync(join(dir, 'overture'), { recursive: true });
  symlinkSync(admin, join(dir, 'admin-pack', `${plate}.jsonl`));
  symlinkSync(rows, join(dir, 'overture', `${plate}.rows.jsonl`));
  const out = join(dir, 'plain.sqlite');
  await buildDirectoryPack({ province: plate, workDir: dir, outFile: out, osmTimestamp: 't', modelGroups: {} });
  return out;
}

function searchOf(plate: string, directory: string, handles: SqlDb[]): Search {
  const address = openSqlite(join(WORK, plate, 'address.sqlite'));
  const listing = openSqlite(directory);
  handles.push(address, listing);
  const store: PackStore = { installed: async () => [plate], open: async () => address, openPart: async (_: string, kind: string) => (kind === 'directory' ? listing : null) };
  return createSearch({ store, borders: embeddedBorders() });
}

type Row = { plate: string; kinds: Record<string, [number, number]>; browseOld: number; browseNew: number; lost: number; osm: number; osmOld: number; osmNew: number; business: number; businessOld: number; businessNew: number };

const WORDS = ['hastane', 'klinik', 'banka', 'cami', 'restoran', 'otel', 'market', 'eczane'];

async function kinds(path: string): Promise<Map<string, number>> {
  const db = openSqlite(path);
  try {
    return new Map((await db.all<{ name: string; n: number }>('SELECT k.name AS name, COUNT(*) AS n FROM poi p JOIN poi_kind k ON k.id = p.kind GROUP BY k.name')).map((r) => [r.name, r.n]));
  } finally {
    await db.close();
  }
}

async function run(plate: string): Promise<Row | null> {
  const old = await plainDirectory(plate);
  const now = join(WORK, plate, 'directory.sqlite');
  if (!old || !existsSync(now)) return null;
  const handles: SqlDb[] = [];
  try {
    const before = searchOf(plate, old, handles);
    const after = searchOf(plate, now, handles);
    const region = await openRegion(handles[0] as SqlDb);
    const a = await kinds(old);
    const b = await kinds(now);
    const row: Row = { plate, kinds: {}, browseOld: 0, browseNew: 0, lost: 0, osm: 0, osmOld: 0, osmNew: 0, business: 0, businessOld: 0, businessNew: 0 };
    for (const name of new Set([...a.keys(), ...b.keys()])) row.kinds[name] = [a.get(name) ?? 0, b.get(name) ?? 0];
    const poiKey = (p: { components: { poiName?: string }; coordinate: LngLat }): string => `${p.components.poiName}|${p.coordinate.join(',')}`;
    const pois = (r: Awaited<ReturnType<Search['resolve']>>): { components: { poiName?: string }; coordinate: LngLat; precision: string }[] => (r.status === 'resolved' ? [r.best, ...r.candidates] : r.status === 'ambiguous' ? r.candidates : []).filter((p) => p.precision === 'poi');
    for (const district of region.districts.slice(0, DISTRICTS)) {
      for (const word of WORDS) {
        const text = `${word} ${district.name}`;
        const x = pois(await before.resolve(text, { limit: 50 }));
        const y = pois(await after.resolve(text, { limit: 50 }));
        const keys = new Set(y.map(poiKey));
        row.browseOld += x.length;
        row.browseNew += y.length;
        row.lost += x.filter((p) => !keys.has(poiKey(p))).length;
      }
    }
    for (const r of shuffle(readSet<TextRecord>('g2', plate), rng(7171 + Number(plate))).slice(0, TEXTS)) {
      const near = async (search: Search): Promise<boolean> => {
        const res = await search.resolve(r.text);
        const best = res.status === 'resolved' ? res.best : res.status === 'ambiguous' ? res.candidates[0] : undefined;
        return !!best && distanceM(best.coordinate, [r.lng, r.lat]) <= 50;
      };
      const x = await near(before);
      const y = await near(after);
      if (r.source === 'osm') {
        row.osm++;
        if (x) row.osmOld++;
        if (y) row.osmNew++;
      } else {
        row.business++;
        if (x) row.businessOld++;
        if (y) row.businessNew++;
      }
    }
    return row;
  } finally {
    for (const db of handles) await db.close();
  }
}

export async function runEnrichCheck(): Promise<Measured> {
  const rows: Row[] = [];
  for (const plate of PLATES) {
    const r = await run(plate);
    if (r) rows.push(r);
  }
  const sum = (key: 'browseOld' | 'browseNew' | 'lost' | 'osm' | 'osmOld' | 'osmNew' | 'business' | 'businessOld' | 'businessNew'): number => rows.reduce((t, r) => t + r[key], 0);
  const groups = new Map<string, [number, number]>();
  for (const r of rows) for (const [g, [x, y]] of Object.entries(r.kinds)) groups.set(g, [(groups.get(g)?.[0] ?? 0) + x, (groups.get(g)?.[1] ?? 0) + y]);
  const moved = [...groups].filter(([, [x, y]]) => x !== y).sort((a, b) => b[1][1] - b[1][0] - (a[1][1] - a[1][0]));
  const table = rows.map((r) => `| ${r.plate} | ${r.browseOld} | ${r.browseNew} | ${r.lost} | ${r.osmOld} → ${r.osmNew} / ${r.osm} | ${r.businessOld} → ${r.businessNew} / ${r.business} |`);
  const groupTable = [...groups].sort((a, b) => b[1][1] - a[1][1]).map(([g, [x, y]]) => `| ${g} | ${x} | ${y} | ${y - x >= 0 ? '+' : ''}${y - x} |`);
  const measured = `5 il: kategori kelimesi + ilçe aramaları (${WORDS.length} kelime × ${DISTRICTS} ilçe) ${sum('browseOld')} → ${sum('browseNew')} işletme, kaybolan ${sum('lost')}; gruplar: ${moved.map(([g, [x, y]]) => `${g} ${y - x >= 0 ? '+' : ''}${y - x}`).join(', ') || 'değişen yok'}; G2 OSM kapıları ≤ 50 m ${sum('osmOld')} → ${sum('osmNew')} / ${sum('osm')}; G2 işletme kapıları ${sum('businessOld')} → ${sum('businessNew')} / ${sum('business')}`;
  const report = ['# Zenginleştirme öncesi ve sonrası (rehber paketi)', '', 'Önce: aynı kodla, model grup eşlemesi olmadan derlenen rehber paketi. Sonra: model grup eşlemesiyle derlenen (yayındaki) rehber paketi. Adres paketi ve diğer her şey aynı.', '', '**Grup sayıları (5 il, işletme):**', '', '| Grup | Önce | Sonra | Fark |', '|---|---|---|---|', ...groupTable, '', '**Kategori kelimesi aramaları ve G2 (300 metin/il):**', '', '| İl | Arama sonucu önce | sonra | Kaybolan | G2 OSM kapısı ≤ 50 m | G2 işletme kapısı ≤ 50 m |', '|---|---|---|---|---|---|', ...table, '', measured, '', 'Kaybolan: eski paketin kategori aramasında çıkan, yenisinde çıkmayan işletme; sonuç sayısı sınırlı olduğu için güveni yüksek model kaynaklı bir işletmenin düşük güvenli bir kural kaynaklısının yerini alması (en çok %1 kabul).', '', 'Rehberin bağımsız doğruluğu (OSM kapılarına göre ortanca 14 m, p90 101 m) ve rehber kapıları aranınca bulunma (%99,2) `scripts/measure-directory.ts` ile ayrıca ölçüldü.', ''].join('\n');
  return { check: 'enrich', pass: rows.length > 0 && sum('lost') <= 0.01 * sum('browseOld') && sum('osmNew') >= sum('osmOld'), measured, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runEnrichCheck().then((result) => {
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'faz-16b-oncesi-sonrasi.md'), result.report);
    console.log(JSON.stringify({ check: result.check, pass: result.pass, measured: result.measured }));
    process.exit(result.pass ? 0 : 1);
  });
}
