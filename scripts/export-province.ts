import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { provinceName } from '../src/core/text/admin';
import { repoRoot } from './addr-sets';

export type ExportRow = { id: string; name: string; lon: number; lat: number; source: string; confidence: number };

const LETTER = ['n', 'w', 'r'];
const osmText = (code: number): string => `${LETTER[code % 4] ?? 'n'}${Math.floor(code / 4)}`;

export function exportRows(packDir: string, plate: string): ExportRow[] {
  const out: ExportRow[] = [];
  const province = provinceName(plate) ?? plate;
  const address = new DatabaseSync(join(packDir, plate, 'address.sqlite'), { readOnly: true });
  try {
    const streets = new Map((address.prepare('SELECT id, name FROM street_name').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
    const hoods = new Map((address.prepare('SELECT id, name FROM neighbourhood').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
    const districts = new Map((address.prepare('SELECT id, name FROM district').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
    for (const r of address.prepare('SELECT street_id, district_id, hood_id, number, lon, lat, osm FROM address ORDER BY id').all() as { street_id: number | null; district_id: number; hood_id: number | null; number: string; lon: number; lat: number; osm: number }[]) {
      const hood = r.hood_id === null ? '' : `${hoods.get(r.hood_id) ?? ''} Mah.`;
      const name = [r.street_id === null ? '' : streets.get(r.street_id), `No:${r.number}`, hood, `${districts.get(r.district_id) ?? ''}/${province}`].filter((x) => x !== '' && x !== undefined).join(' ');
      out.push({ id: `D${plate}-${osmText(r.osm)}`, name, lon: r.lon / 1e6, lat: r.lat / 1e6, source: 'osm', confidence: 1 });
    }
  } finally {
    address.close();
  }
  const file = join(packDir, plate, 'buildings2.sqlite');
  if (existsSync(file)) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      for (const r of db.prepare('SELECT gid, lon, lat, num, nsrc, pnum, pconf FROM building WHERE num IS NOT NULL OR pnum IS NOT NULL ORDER BY id').all() as { gid: string; lon: number; lat: number; num: string | null; nsrc: number | null; pnum: number | null; pconf: number | null }[]) {
        const known = r.num !== null;
        out.push({ id: `B${plate}-${r.gid}`, name: `No:${known ? r.num : r.pnum}`, lon: r.lon / 1e6, lat: r.lat / 1e6, source: known ? (r.nsrc === 2 ? 'directory' : 'osm-building') : 'predicted', confidence: known ? (r.nsrc === 2 ? 0.5 : 1) : (r.pconf ?? 0) / 100 });
      }
    } finally {
      db.close();
    }
  }
  return out;
}

const csvCell = (value: string | number): string => (typeof value === 'number' ? String(value) : /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export const toCsv = (rows: ExportRow[]): string => ['id,ad,boylam,enlem,kaynak,guven', ...rows.map((r) => [r.id, r.name, r.lon.toFixed(6), r.lat.toFixed(6), r.source, r.confidence.toFixed(2)].map(csvCell).join(','))].join('\n') + '\n';

export const toGeoJson = (rows: ExportRow[]): string => JSON.stringify({ type: 'FeatureCollection', features: rows.map((r) => ({ type: 'Feature', id: r.id, geometry: { type: 'Point', coordinates: [Number(r.lon.toFixed(6)), Number(r.lat.toFixed(6))] }, properties: { name: r.name, source: r.source, confidence: r.confidence } })) });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plates = (process.argv[2] ?? '').split(',').filter((p) => /^\d{2}$/.test(p));
  if (plates.length === 0) {
    console.error('kullanım: tsx scripts/export-province.ts 34[,06,...] [--out <klasör>]');
    process.exit(2);
  }
  const outIndex = process.argv.indexOf('--out');
  const out = outIndex >= 0 ? (process.argv[outIndex + 1] as string) : join(repoRoot, 'dist', 'export');
  const packs = join(repoRoot, 'dist', 'work', '261028', 'packs');
  mkdirSync(out, { recursive: true });
  for (const plate of plates) {
    const rows = exportRows(packs, plate);
    writeFileSync(join(out, `${plate}.csv`), toCsv(rows));
    writeFileSync(join(out, `${plate}.geojson`), toGeoJson(rows));
    console.log(`${plate}: ${rows.length} kayıt`);
  }
}
