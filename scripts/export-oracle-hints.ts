import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { createSearch } from '../src/core/address/search';
import type { LngLat } from '../src/core/geo/cells';
import { createLearnedLayer } from '../src/core/learned/layer';
import type { PackStore } from '../src/core/ports';
import { createBorders } from '../src/core/region/borders';
import { provinceName } from '../src/core/text/admin';
import { nameKey } from '../src/core/text/fold';
import { streetKey } from '../src/core/text/street';
import { openSqlite } from '../src/node/sqlite';
import { repoRoot } from './addr-sets';
import { knownStreets } from './hints-geo';

export type HintItem = {
  id: string;
  plate: string;
  set: 'ipucu' | 'pakette';
  text: string;
  truth: LngLat | null;
  meta: { street: string; district: string; pois: number };
  sdk: { status: string; level: string | null; learned: boolean; precision: string | null; coordinate: LngLat | null };
};

const packs = join(repoRoot, 'dist', 'work', '261028', 'packs');
const PER_PLATE = Number(process.env.ORACLE_PER_PLATE ?? 3);
const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));

const spread = <T>(list: T[], count: number, offset: number): T[] => {
  if (list.length <= count) return list;
  const step = list.length / count;
  return Array.from({ length: count }, (_, i) => list[Math.floor(i * step + (offset % Math.max(1, Math.floor(step))))]!);
};

export async function exportItems(): Promise<HintItem[]> {
  const items: HintItem[] = [];
  for (let i = 1; i <= 81; i++) {
    const plate = String(i).padStart(2, '0');
    const dir = join(packs, plate);
    if (!['address', 'directory', 'learned'].every((n) => existsSync(join(dir, `${n}.sqlite`)))) continue;
    const addr = new DatabaseSync(join(dir, 'address.sqlite'), { readOnly: true });
    const directory = new DatabaseSync(join(dir, 'directory.sqlite'), { readOnly: true });
    const province = provinceName(plate) ?? '';
    try {
      const known = knownStreets(addr);
      const store: PackStore = { installed: async () => [plate], open: async () => openSqlite(join(dir, 'address.sqlite')), openPart: async (_r, kind) => (kind === 'learned' ? openSqlite(join(dir, 'learned.sqlite')) : null) };
      const search = createSearch({ store, borders, layers: [createLearnedLayer(store)] });
      const rows = directory.prepare('SELECT p.lon lon, p.lat lat, d.name district, t.text street, i.number number FROM poi p JOIN poi_info i ON i.id = p.id JOIN info_text t ON t.id = i.street JOIN district d ON d.id = p.district_id WHERE i.number IS NOT NULL ORDER BY p.id').all() as { lon: number; lat: number; district: string; street: string; number: string }[];
      const missing: typeof rows = [];
      const seen = new Set<string>();
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(`${nameKey(r.district)}|${streetKey(r.street).key}`, (counts.get(`${nameKey(r.district)}|${streetKey(r.street).key}`) ?? 0) + 1);
      for (const r of rows) {
        const key = streetKey(r.street).key;
        const id = `${nameKey(r.district)}|${key}`;
        if (key === '' || known.byDistrict.has(id) || seen.has(id)) continue;
        seen.add(id);
        missing.push(r);
      }
      const doors = addr.prepare('SELECT n.name street, a.number number, d.name district, a.lon lon, a.lat lat FROM address a JOIN street_name n ON n.id = a.street_id JOIN district d ON d.id = a.district_id WHERE a.number IS NOT NULL ORDER BY (a.id * 2654435761) % 1000003 LIMIT 1').all() as { street: string; number: string; district: string; lon: number; lat: number }[];
      const picks = [
        ...spread(missing, PER_PLATE, i).map((r) => ({ set: 'ipucu' as const, street: r.street, number: r.number, district: r.district, truth: [r.lon / 1e6, r.lat / 1e6] as LngLat, pois: counts.get(`${nameKey(r.district)}|${streetKey(r.street).key}`) ?? 1 })),
        ...doors.map((r) => ({ set: 'pakette' as const, street: r.street, number: r.number, district: r.district, truth: [r.lon / 1e6, r.lat / 1e6] as LngLat, pois: 0 })),
      ];
      for (const p of picks) {
        const text = process.env.ORACLE_NO_DISTRICT === "1" ? `${p.street} No:${p.number} ${province}` : `${p.street} No:${p.number} ${p.district} ${province}`;
        const result = await search.resolve(text);
        const first = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
        items.push({
          id: `${plate}:${items.length}`,
          plate,
          set: p.set,
          text,
          truth: p.set === 'pakette' ? p.truth : null,
          meta: { street: p.street, district: p.district, pois: p.pois },
          sdk: { status: result.status, level: first ? (first.components.street ? 'sokak' : first.components.neighbourhood ? 'mahalle' : 'ilçe') : null, learned: first?.source === 'learned', precision: first?.precision ?? null, coordinate: (first?.coordinate as LngLat | undefined) ?? null },
        });
      }
    } finally {
      addr.close();
      directory.close();
    }
  }
  return items;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--out');
  const out = at >= 0 ? process.argv[at + 1] : undefined;
  if (!out) {
    console.error('kullanım: --out <dosya>');
    process.exit(2);
  }
  exportItems().then((items) => {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(items));
    console.log(JSON.stringify({ written: out, items: items.length, ipucu: items.filter((i) => i.set === 'ipucu').length, pakette: items.filter((i) => i.set === 'pakette').length }));
  }).catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
}
