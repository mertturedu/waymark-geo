import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { formatUnit } from '../src/core/address/unit';
import { createSearch } from '../src/core/address/search';
import { distanceM } from '../src/core/geo/distance';
import { createBorders } from '../src/core/region/borders';
import { provinceName } from '../src/core/text/admin';
import type { Lang } from '../src/core/text/types';
import type { PackStore } from '../src/core/ports';
import { openSqlite } from '../src/node/sqlite';
import { BOX } from './build-building-device-set';
import { readDoors } from './addr-seq-eval';
import { addressPackOf } from './build-buildings-v2';
import { repoRoot, setsDir } from './addr-sets';

export const LANGS: Lang[] = ['tr', 'en', 'de', 'ar', 'ru', 'el'];

export type UnitCase = { id: string; text: string; expected: { status: string; point: [number, number] | null; unit: unknown; formatted: string[] } };

const PLAIN = ['Kat 3 Daire 7', '5. kat 12 nolu daire', 'zemin kat daire 2', 'K:2 D:5', 'Kat 40 Daire 3', 'Daire 900', 'Kat 1', 'D:14 K:4', 'Kat: -1 Daire 1', '2. kat daire 3'];

async function main(): Promise<void> {
  const plate = process.argv[2] ?? '34';
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  const addressFile = addressPackOf(plate);
  const buildingsFile = join(dir, `buildings2-${plate}.sqlite`);
  const address = openSqlite(addressFile);
  const buildings = openSqlite(buildingsFile);
  const store: PackStore = { installed: async () => [plate], open: async () => address, openPart: async (_: string, kind: string) => (kind === 'buildings2' ? buildings : null) } as PackStore;
  const search = createSearch({ store, borders: createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin'))) });
  const doors = readDoors(addressFile).filter((d) => d.lon >= BOX.west && d.lon <= BOX.east && d.lat >= BOX.south && d.lat <= BOX.north && d.suffix === '');
  const raw = new DatabaseSync(addressFile, { readOnly: true });
  const names = new Map((raw.prepare('SELECT id, name FROM street_name').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
  const districts = new Map((raw.prepare('SELECT id, name FROM district').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
  raw.close();
  const textOf = (d: (typeof doors)[number]): string => `${names.get(d.street)} ${d.num}, ${districts.get(d.district)}, ${provinceName(plate)}`;
  const picked: { text: string; id: string }[] = [];
  const step = Math.max(1, Math.floor(doors.length / 40));
  for (let i = 0, k = 0; i < doors.length && picked.length < 40; i += step, k++) {
    const d = doors[i] as (typeof doors)[number];
    if (!names.has(d.street)) continue;
    picked.push({ id: `p${d.id}`, text: `${textOf(d)} ${PLAIN[k % PLAIN.length]}` });
  }
  const bdb = new DatabaseSync(buildingsFile, { readOnly: true });
  const blocks = (bdb.prepare("SELECT lon, lat, name FROM building WHERE (name LIKE '% Blok' OR name LIKE '%Block') AND lon BETWEEN ? AND ? AND lat BETWEEN ? AND ? ORDER BY id").all(Math.round(BOX.west * 1e6), Math.round(BOX.east * 1e6), Math.round(BOX.south * 1e6), Math.round(BOX.north * 1e6)) as { lon: number; lat: number; name: string }[]);
  bdb.close();
  const step2 = Math.max(1, Math.floor(blocks.length / 60));
  for (let i = 0, k = 0; i < blocks.length && k < 60; i += step2, k++) {
    const b = blocks[i] as (typeof blocks)[number];
    const centre: [number, number] = [b.lon / 1e6, b.lat / 1e6];
    const near = doors.filter((d) => names.has(d.street) && distanceM([d.lon, d.lat], centre) <= 60).sort((x, y) => distanceM([x.lon, x.lat], centre) - distanceM([y.lon, y.lat], centre))[0];
    if (!near) continue;
    const key = b.name.replace(/\s*(blok|block)\s*/i, '').trim();
    picked.push({ id: `b${near.id}-${k}`, text: `${textOf(near)} ${key} Blok Kat ${1 + (k % 5)} Daire ${3 + k}` });
  }
  const cases: UnitCase[] = [];
  for (const c of picked) {
    const result = await search.resolve(c.text);
    const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
    cases.push({ id: c.id, text: c.text, expected: { status: result.status, point: best ? best.coordinate : null, unit: best?.unit ?? null, formatted: best?.unit ? LANGS.map((l) => formatUnit(best.unit as NonNullable<typeof best.unit>, l)) : [] } });
  }
  await address.close();
  await buildings.close();
  writeFileSync(join(dir, `unit-${plate}.json`), JSON.stringify(cases));
  const withUnit = cases.filter((c) => c.expected.unit !== null).length;
  const withBlock = cases.filter((c) => (c.expected.unit as { block?: { building: number | null } } | null)?.block?.building != null).length;
  console.log(`${plate}: ${cases.length} vaka, ${withUnit} tanesi birimle, ${withBlock} tanesi blok bulunmuş`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
