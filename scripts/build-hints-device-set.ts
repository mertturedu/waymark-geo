import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createSearch } from '../src/core/address/search';
import { createLearnedLayer } from '../src/core/learned/layer';
import type { PackStore } from '../src/core/ports';
import { embeddedBorders } from '../src/core/region/embedded';
import { provinceName } from '../src/core/text/admin';
import { openSqlite } from '../src/node/sqlite';
import { repoRoot, setsDir } from './addr-sets';

export const HINTS_PLATE = '13';
const WITH_DISTRICT = 24;
const WITHOUT_DISTRICT = 12;
const DOORS = 12;
const LISTED = 12;
export const HINT_PARTS = ['directory', 'buildings2'] as const;
export type HintParts = Partial<Record<(typeof HINT_PARTS)[number], string>>;

export type HintsCase = { id: string; text: string; expected: { status: string; top: string } };

const spread = <T>(list: T[], count: number): T[] => (list.length <= count ? list : Array.from({ length: count }, (_, i) => list[Math.floor((i * list.length) / count)]!));

function listedDoors(file: string | undefined): { street: string; number: string; district: string }[] {
  if (!file) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare('SELECT n.name street, a.number number, d.name district FROM address a JOIN street_name n ON n.id = a.street_id JOIN district d ON d.id = a.district_id ORDER BY (a.id * 2654435761) % 1000003 LIMIT ?').all(LISTED) as { street: string; number: string; district: string }[];
  } finally {
    db.close();
  }
}

export async function hintsCases(addressFile: string, learnedFile: string, plate = HINTS_PLATE, parts: HintParts = {}): Promise<HintsCase[]> {
  const address = openSqlite(addressFile);
  const learned = openSqlite(learnedFile);
  const extra = new Map(await Promise.all(HINT_PARTS.filter((kind) => parts[kind]).map(async (kind) => [kind, openSqlite(parts[kind] as string)] as const)));
  const store: PackStore = { installed: async () => [plate], open: async () => address, openPart: async (_r, kind) => (kind === 'learned' ? learned : (extra.get(kind as (typeof HINT_PARTS)[number]) ?? null)) };
  const search = createSearch({ store, borders: embeddedBorders(), layers: [createLearnedLayer(store)] });
  const province = provinceName(plate) ?? plate;
  const db = new DatabaseSync(addressFile, { readOnly: true });
  const hintDb = new DatabaseSync(learnedFile, { readOnly: true });
  const districts = new Map((db.prepare('SELECT key, name FROM district').all() as { key: string; name: string }[]).map((d) => [d.key, d.name]));
  const hints = (hintDb.prepare('SELECT district, name FROM hint ORDER BY district, name').all() as { district: string; name: string }[]).filter((h) => districts.has(h.district));
  const doors = db.prepare('SELECT n.name street, a.number number, d.name district FROM address a JOIN street_name n ON n.id = a.street_id JOIN district d ON d.id = a.district_id WHERE a.number IS NOT NULL ORDER BY (a.id * 2654435761) % 1000003 LIMIT ?').all(DOORS) as { street: string; number: string; district: string }[];
  const texts: [string, string][] = [
    ...spread(hints, WITH_DISTRICT).map((h, i): [string, string] => [`hint-${i}`, `${h.name} No:${7 + i} ${districts.get(h.district)} ${province}`]),
    ...spread(hints, WITHOUT_DISTRICT).map((h, i): [string, string] => [`province-${i}`, `${h.name} No:${3 + i} ${province}`]),
    ...doors.map((d, i): [string, string] => [`door-${i}`, `${d.street} No:${d.number} ${d.district} ${province}`]),
    ...listedDoors(parts.directory).map((d, i): [string, string] => [`listed-${i}`, `${d.street} No:${d.number} ${d.district} ${province}`]),
  ];
  const out: HintsCase[] = [];
  for (const [id, text] of texts) {
    const result = await search.resolve(text);
    const top = (result.status === 'resolved' ? [result.best, ...result.candidates] : result.status === 'ambiguous' ? result.candidates : []).slice(0, 3);
    out.push({ id, text, expected: { status: result.status, top: JSON.stringify(top.map((p) => ({ id: p.id, name: p.label, point: p.coordinate, precision: p.precision, source: p.source, approximate: p.approximate }))) } });
  }
  db.close();
  hintDb.close();
  await address.close();
  await learned.close();
  for (const db of extra.values()) await db.close();
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plate = process.argv[2] ?? HINTS_PLATE;
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  const packs = join(repoRoot, 'dist', 'work', '261028', 'packs', plate);
  writeFileSync(join(dir, 'plate.txt'), plate);
  copyFileSync(join(packs, 'address.sqlite'), join(dir, `hints-${plate}-address.sqlite`));
  copyFileSync(join(packs, 'learned.sqlite'), join(dir, `hints-${plate}-learned.sqlite`));
  for (const kind of HINT_PARTS) copyFileSync(join(packs, `${kind}.sqlite`), join(dir, `hints-${plate}-${kind}.sqlite`));
  const parts = Object.fromEntries(HINT_PARTS.map((kind) => [kind, join(dir, `hints-${plate}-${kind}.sqlite`)]));
  hintsCases(join(dir, `hints-${plate}-address.sqlite`), join(dir, `hints-${plate}-learned.sqlite`), plate, parts).then((cases) => {
    writeFileSync(join(dir, 'hints.json'), JSON.stringify(cases));
    const found = (prefix: string): string => `${cases.filter((c) => c.id.startsWith(prefix) && c.expected.top.includes('"source":"learned"')).length}/${cases.filter((c) => c.id.startsWith(prefix)).length}`;
    console.log(JSON.stringify({ cases: cases.length, hintsLearned: found('hint-'), provinceLearned: found('province-'), doorsLearned: found('door-'), listed: cases.filter((c) => c.id.startsWith('listed-')).length, listedFromDirectory: cases.filter((c) => c.id.startsWith('listed-') && c.expected.top.includes('"source":"overture"')).length }));
  });
}
