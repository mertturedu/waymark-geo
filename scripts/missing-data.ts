import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanName } from '../pipeline/build/name-clean';
import { openSqlite } from '../src/node/sqlite';
import { openRegion } from '../src/core/address/pack';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const WORK = join(repoRoot, 'dist', 'work', '261028', 'packs');
const OUT = join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'kapsama');
const SAMPLE = 40;

export type Missing = { plate: string; streets: number; noKind: number; noGeometry: number; unclear: number; doorsNoStreet: number; doors: number; hoods: number; hoodsNoPolygon: number; dirty: number; dirtyKinds: Record<string, number>; samples: { kind: string; text: string }[] };

export async function missingOf(plate: string): Promise<Missing | null> {
  const file = join(WORK, plate, 'address.sqlite');
  if (!existsSync(file)) return null;
  const db = openSqlite(file);
  try {
    const region = await openRegion(db);
    const streets = await db.all<{ id: number; name: string; kind: string | null; parts: number }>('SELECT s.id AS id, s.name AS name, s.kind AS kind, (SELECT COUNT(*) FROM street_part p WHERE p.name_id = s.id) AS parts FROM street_name s ORDER BY s.id');
    const doors = (await db.all<{ n: number; open: number }>('SELECT COUNT(*) AS n, SUM(street_id IS NULL) AS open FROM address'))[0] ?? { n: 0, open: 0 };
    const polys = (await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM neighbourhood WHERE poly IS NULL'))[0]?.n ?? 0;
    const row: Missing = { plate, streets: streets.length, noKind: 0, noGeometry: 0, unclear: 0, doorsNoStreet: doors.open ?? 0, doors: doors.n, hoods: region.hoods.length, hoodsNoPolygon: polys, dirty: 0, dirtyKinds: {}, samples: [] };
    const sample = (kind: string, text: string): void => {
      if (row.samples.filter((s) => s.kind === kind).length < SAMPLE) row.samples.push({ kind, text });
    };
    for (const s of streets) {
      if (s.kind === null) {
        row.noKind++;
        sample('türü yok', s.name);
      }
      if (s.parts === 0) {
        row.noGeometry++;
        sample('çizgisi yok', s.name);
      }
      if (!/[\p{L}]{2}/u.test(s.name)) {
        row.unclear++;
        sample('adı anlaşılmıyor', s.name);
      }
      const cleaned = cleanName(s.name);
      if (cleaned.changes.length > 0) {
        row.dirty++;
        for (const change of cleaned.changes) {
          const kind = change.split(':')[0] as string;
          row.dirtyKinds[kind] = (row.dirtyKinds[kind] ?? 0) + 1;
        }
        sample('bozuk ad', `${s.name} → ${cleaned.name} (${cleaned.changes.join(', ')})`);
      }
    }
    return row;
  } finally {
    await db.close();
  }
}

export async function runMissing(plates: string[]): Promise<{ rows: Missing[]; text: string }> {
  mkdirSync(OUT, { recursive: true });
  const rows: Missing[] = [];
  for (const plate of plates) {
    const row = await missingOf(plate);
    if (row) rows.push(row);
  }
  const sum = (key: 'streets' | 'noKind' | 'noGeometry' | 'unclear' | 'doorsNoStreet' | 'doors' | 'hoods' | 'hoodsNoPolygon' | 'dirty'): number => rows.reduce((t, r) => t + r[key], 0);
  const kinds: Record<string, number> = {};
  for (const r of rows) for (const [k, n] of Object.entries(r.dirtyKinds)) kinds[k] = (kinds[k] ?? 0) + n;
  writeFileSync(join(OUT, 'eksik-veri.csv'), ['il;tür;metin', ...rows.flatMap((r) => r.samples.map((s) => `${r.plate};${s.kind};${s.text.replace(/;/g, ',')}`))].join('\n') + '\n');
  const text = ['# Eksik ve bozuk veri raporu (insan incelemesine)', '', `${rows.length} il. Adres paketlerinden: türü anlaşılmayan, çizgisi olmayan, adı anlaşılmayan sokaklar; sokağı olmayan kapılar; sınırı olmayan mahalleler; kural ve sözlükle düzeltilebilen bozuk adlar (büyük/küçük harf, çift boşluk, tür yazım hatası). Örnekler \`eksik-veri.csv\` içinde (her ilde her türden ${SAMPLE}).`, '', `| Ölçü | Sayı | Pay |`, '|---|---|---|', `| Sokak adı | ${sum('streets')} | |`, `| Türü yok (Sokak/Cadde... anlaşılmıyor) | ${sum('noKind')} | %${((100 * sum('noKind')) / Math.max(1, sum('streets'))).toFixed(1)} |`, `| Çizgisi yok | ${sum('noGeometry')} | %${((100 * sum('noGeometry')) / Math.max(1, sum('streets'))).toFixed(1)} |`, `| Adı anlaşılmıyor | ${sum('unclear')} | %${((100 * sum('unclear')) / Math.max(1, sum('streets'))).toFixed(2)} |`, `| Bozuk ad (kuralla düzeltilebilir) | ${sum('dirty')} | %${((100 * sum('dirty')) / Math.max(1, sum('streets'))).toFixed(1)} |`, `| Kapı | ${sum('doors')} | |`, `| Sokağı olmayan kapı | ${sum('doorsNoStreet')} | %${((100 * sum('doorsNoStreet')) / Math.max(1, sum('doors'))).toFixed(1)} |`, `| Mahalle | ${sum('hoods')} | |`, `| Sınırı (poligonu) olmayan mahalle | ${sum('hoodsNoPolygon')} | %${((100 * sum('hoodsNoPolygon')) / Math.max(1, sum('hoods'))).toFixed(1)} |`, '', `Bozuk ad türleri: ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ') || 'yok'}. Düzeltmeler **uygulanmadı** (yalnız rapor): ad etiketini değiştirir.`, ''].join('\n');
  writeFileSync(join(OUT, 'eksik-veri.md'), text);
  return { rows, text };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMissing(Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'))).then(({ rows }) => console.log(JSON.stringify({ plates: rows.length, streets: rows.reduce((t, r) => t + r.streets, 0), dirty: rows.reduce((t, r) => t + r.dirty, 0) })));
}
