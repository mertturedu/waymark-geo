import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSearch } from '../src/core/address/search';
import { createBorders } from '../src/core/region/borders';
import { readFileSync } from 'node:fs';
import type { PackStore } from '../src/core/ports';
import { openSqlite } from '../src/node/sqlite';
import { BOX } from './build-building-device-set';
import { readDoors } from './addr-seq-eval';
import { addressPackOf } from './build-buildings-v2';
import { provinceName } from '../src/core/text/admin';
import { repoRoot, setsDir } from './addr-sets';

export type SequenceCase = { id: string; text: string; expected: { status: string; point: [number, number] | null; radiusM: number | null; notes: string[] } };

async function main(): Promise<void> {
  const plate = process.argv[2] ?? '34';
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  const addressFile = addressPackOf(plate);
  const buildingsFile = join(dir, `buildings2-${plate}.sqlite`);
  const address = openSqlite(addressFile);
  const buildings = openSqlite(buildingsFile);
  const store: PackStore = { installed: async () => [plate], open: async () => address, openPart: async (_: string, kind: string) => (kind === 'buildings2' ? buildings : null) } as PackStore;
  const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
  const search = createSearch({ store, borders });
  const doors = readDoors(addressFile).filter((d) => d.lon >= BOX.west && d.lon <= BOX.east && d.lat >= BOX.south && d.lat <= BOX.north);
  const byStreet = new Map<number, typeof doors>();
  for (const d of doors) byStreet.set(d.street, [...(byStreet.get(d.street) ?? []), d]);
  const names = new Map<number, string>();
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(addressFile, { readOnly: true });
  for (const r of raw.prepare('SELECT id, name FROM street_name').all() as { id: number; name: string }[]) names.set(r.id, r.name);
  const districts = new Map((raw.prepare('SELECT id, name FROM district').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
  raw.close();
  const cases: SequenceCase[] = [];
  for (const [street, list] of byStreet) {
    if (cases.length >= 160) break;
    const nums = new Set(list.map((d) => d.num));
    if (list.length < 4) continue;
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    for (let n = lo + 1; n < hi && cases.length < 160; n++) {
      if (nums.has(n)) continue;
      const anchor = list[0];
      if (!anchor) break;
      cases.push({ id: `${street}:${n}`, text: `${names.get(street)} ${n}, ${districts.get(anchor.district)}, ${provinceName(plate)}`, expected: { status: '', point: null, radiusM: null, notes: [] } });
      break;
    }
  }
  for (const c of cases) {
    const result = await search.resolve(c.text);
    const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
    c.expected = { status: result.status, point: best ? best.coordinate : null, radiusM: best?.radiusM ?? null, notes: best?.notes ?? [] };
  }
  await address.close();
  await buildings.close();
  writeFileSync(join(dir, `sequence-${plate}.json`), JSON.stringify(cases));
  copyFileSync(addressFile, join(dir, `sequence-${plate}-address.sqlite`));
  const used = cases.filter((c) => c.expected.radiusM !== null).length;
  console.log(`${plate}: ${cases.length} vaka, ${used} tanesi bina dizisiyle cevaplandı`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
