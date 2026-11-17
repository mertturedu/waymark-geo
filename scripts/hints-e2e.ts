import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSearch } from '../src/core/address/search';
import { createLearnedLayer } from '../src/core/learned/layer';
import type { PackStore } from '../src/core/ports';
import { createBorders } from '../src/core/region/borders';
import { openSqlite } from '../src/node/sqlite';
import { distanceM } from '../src/core/geo/distance';
import { repoRoot } from './addr-sets';

const plate = process.argv[2] ?? '42';
const count = Number(process.argv[3] ?? 40);
const packs = join(repoRoot, 'dist', 'work', '261028', 'packs', plate, 'address.sqlite');
const learned = join(repoRoot, 'dist', 'hints', plate, 'learned.sqlite');
const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
const base: PackStore = { installed: async () => [plate], open: async () => openSqlite(packs), openPart: async () => null };
const withHints: PackStore = { ...base, openPart: async (_r, kind) => (kind === 'learned' ? openSqlite(learned) : null) };
const before = createSearch({ store: base, borders });
const after = createSearch({ store: withHints, borders, layers: [createLearnedLayer(withHints)] });

const db = openSqlite(learned);
const rows = await db.all<{ district: string; name: string; lng: number; lat: number; radius: number }>('SELECT district, name, lng, lat, radius FROM hint ORDER BY (lng * 31 + lat) % 997 LIMIT ?', [count]);
const districts = JSON.parse(readFileSync(join(repoRoot, 'src', 'core', 'text', 'data', 'admin.json'), 'utf8')) as { districts: { province: string; names: { tr: string } }[] };
const display = new Map(districts.districts.filter((d) => d.province === plate).map((d) => [d.names.tr.toLocaleLowerCase('tr').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i'), d.names.tr]));
const stat = { n: 0, before: { street: 0, hood: 0, other: 0 }, after: { street: 0, learned: 0, within: 0 } };
const samples: string[] = [];
for (const r of rows) {
  const district = display.get(r.district) ?? r.district;
  const text = `${r.name} No:6 ${district}`;
  const a = await before.resolve(text);
  const b = await after.resolve(text);
  const pa = a.status === 'resolved' ? a.best : a.status === 'ambiguous' ? a.candidates[0] : undefined;
  const pb = b.status === 'resolved' ? b.best : b.status === 'ambiguous' ? b.candidates[0] : undefined;
  stat.n++;
  if (pa?.components.street) stat.before.street++;
  if (pb?.components.street) stat.after.street++;
  if (pb?.source === 'learned') {
    stat.after.learned++;
    if (distanceM(pb.coordinate, [r.lng / 1e6, r.lat / 1e6]) <= r.radius) stat.after.within++;
  }
  if (samples.length < 5) samples.push(`${text} | önce: ${pa?.label ?? '-'} (${pa?.precision}) | sonra: ${pb?.label ?? '-'} (${pb?.precision}, ${pb?.source})`);
}
console.log(JSON.stringify(stat));
console.log(samples.join('\n'));
