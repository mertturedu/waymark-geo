import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSearch } from '../src/core/address/search';
import { standardAddress } from '../src/core/address/standard';
import { kindText, noteText } from '../src/core/address/validate-text';
import { createBorders } from '../src/core/region/borders';
import { provinceName } from '../src/core/text/admin';
import type { Lang } from '../src/core/text/types';
import type { PackStore } from '../src/core/ports';
import { openSqlite } from '../src/node/sqlite';
import { BOX } from './build-building-device-set';
import { readDoors } from './addr-seq-eval';
import { addressPackOf } from './build-buildings-v2';
import { load } from './addr-validate-eval';
import { pick, repoRoot, seeded, seedOf, setsDir } from './addr-sets';

export const LANGS: Lang[] = ['tr', 'en', 'de', 'ar', 'ru', 'el'];

export type ValidateCase = {
  id: string;
  text: string;
  expected: { status: string; codes: string[]; fix: unknown[]; message: string[]; suggestions: unknown; standard: string[]; kind: string[]; messages: string[][] };
};

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
  const data = load(plate);
  const rng = seeded(seedOf(`validate-device-${plate}`));
  const province = provinceName(plate) ?? plate;
  const doors = readDoors(addressFile).filter((d) => d.lon >= BOX.west && d.lon <= BOX.east && d.lat >= BOX.south && d.lat <= BOX.north && d.suffix === '' && d.hood !== null && data.streets.has(d.street));
  const texts: { id: string; text: string }[] = [];
  const nameOf = (d: (typeof doors)[number]) => ({ street: data.streets.get(d.street) as string, district: data.districts.get(d.district) as string, hood: data.hoods.get(d.hood as number)?.name as string });
  const make = (kind: string, count: number, build: (d: (typeof doors)[number], n: ReturnType<typeof nameOf>) => string | null): void => {
    let made = 0;
    for (let tries = 0; made < count && tries < count * 50; tries++) {
      const d = pick(rng, doors);
      const text = build(d, nameOf(d));
      if (text) texts.push({ id: `${kind}${made++}`, text });
    }
  };
  make('ok', 8, (d, n) => `${n.hood} Mah. ${n.street} No:${d.num} ${n.district}/${province}`);
  make('dist', 6, (d, n) => `${n.hood} Mah. ${n.street} No:${d.num} ${pick(rng, [...data.districts.values()].filter((x) => x !== n.district))}/${province}`);
  make('hood', 6, (d, n) => {
    const own = data.hoodsOf.get(d.street) ?? new Set<number>();
    const pool = [...data.hoods].filter(([id, h]) => h.district === d.district && !own.has(id));
    return pool.length === 0 ? null : `${pick(rng, pool)[1].name} Mah. ${n.street} No:${d.num} ${n.district}/${province}`;
  });
  make('nonum', 5, (_d, n) => `${n.hood} Mah. ${n.street} ${n.district}/${province}`);
  make('range', 5, (d, n) => `${n.hood} Mah. ${n.street} No:${(data.maxNum.get(`${d.street}:${d.district}`) ?? d.num) + 401} ${n.district}/${province}`);
  make('typo', 4, (d, n) => (n.hood.length >= 6 ? `${n.hood.slice(0, 2)}${n.hood.slice(3)} Mah. ${n.street} No:${d.num} ${n.district}/${province}` : null));
  make('unit', 6, (d, n) => `${n.hood} Mah. ${n.street} No:${d.num} ${['Kat 40 Daire 3', 'Daire 900', 'Z Blok Kat 2 Daire 5', 'Kat 3 Daire 7', 'zemin kat daire 2', '5. kat 1 nolu daire'][texts.length % 6]} ${n.district}/${province}`);
  const cases: ValidateCase[] = [];
  for (const t of texts) {
    const v = await search.validate(t.text, { language: 'tr' });
    cases.push({
      ...t,
      expected: {
        status: v.status,
        codes: v.notes.map((n) => n.code),
        fix: v.notes.map((n) => n.fix ?? null),
        message: v.notes.map((n) => n.message),
        suggestions: v.suggestions,
        standard: v.place ? LANGS.map((l) => standardAddress(v.place!, l).text) : [],
        kind: v.place ? LANGS.map((l) => kindText(v.place!.precision, l)) : [],
        messages: v.notes.map((n) => LANGS.map((l) => noteText(n.code, l, {}))),
      },
    });
  }
  await address.close();
  await buildings.close();
  writeFileSync(join(dir, `validate-${plate}.json`), JSON.stringify(cases));
  const withNotes = cases.filter((c) => c.expected.codes.length > 0).length;
  const statuses = new Map<string, number>();
  for (const c of cases) statuses.set(c.expected.status, (statuses.get(c.expected.status) ?? 0) + 1);
  console.log(`${plate}: ${cases.length} vaka, ${withNotes} tanesi notlu`, Object.fromEntries(statuses));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
