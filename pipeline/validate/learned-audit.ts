import { DatabaseSync } from 'node:sqlite';
import { validKey } from '../../src/core/learn/key';
import { LEARNED_APPLICATION_ID, LEARNED_FORMAT, LEARNED_USER_VERSION } from '../../src/core/learned/types';
import { hasPersonalData } from '../real/records';

type Rows = Record<string, unknown>[];

const TABLES: Record<string, string[]> = {
  meta: ['key', 'value'],
  door: ['key', 'lng', 'lat', 'trusted', 'sources', 'spread', 'origin'],
  layout: ['key', 'per', 'basement', 'floors', 'fit', 'samples', 'ranges'],
  entrance: ['key', 'idx', 'lng', 'lat', 'sources'],
  hint: ['district', 'name', 'lng', 'lat', 'radius', 'sources', 'origin'],
  way: ['district', 'name', 'line', 'doors'],
};
const META_KEYS = ['format', 'region', 'doors', 'layouts'];
const MAX_SOURCES = 100_000;

export function auditLearned(path: string, region: string | null = null, bbox: readonly number[] | null = null, pad = 0.05): { errors: string[]; counts: { doors: number; layouts: number; entrances: number; hints: number } } {
  const errors: string[] = [];
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const all = (sql: string): Rows => db.prepare(sql).all() as Rows;
    const number = (sql: string): number => Number(Object.values(all(sql)[0] ?? { n: 0 })[0]);
    const integrity = String(Object.values(all('PRAGMA integrity_check')[0] ?? {})[0]);
    if (integrity !== 'ok') errors.push(`SQLite bütünlük denetimi: ${integrity.slice(0, 200)}`);
    if (number('PRAGMA user_version') !== LEARNED_USER_VERSION) errors.push('user_version beklenen sürümde değil');
    if (number('PRAGMA application_id') !== LEARNED_APPLICATION_ID) errors.push('application_id beklenen değerde değil');

    const tables = all("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r.name)).sort();
    const expected = Object.keys(TABLES).sort();
    if (tables.join() !== expected.join()) errors.push(`tablolar beklenenden farklı: ${tables.join(', ')}`);
    for (const table of expected) {
      const columns = all(`PRAGMA table_info(${table})`).map((r) => String(r.name));
      if (columns.join() !== (TABLES[table] as string[]).join()) errors.push(`${table} sütunları beklenenden farklı: ${columns.join(', ')} (kişi ya da zaman alanı olamaz)`);
    }
    if (errors.length > 0) return { errors, counts: { doors: 0, layouts: 0, entrances: 0, hints: 0 } };

    const meta = new Map(all('SELECT key, value FROM meta').map((r) => [String(r.key), String(r.value)]));
    for (const key of meta.keys()) if (!META_KEYS.includes(key)) errors.push(`meta anahtarı beklenmiyor: ${key}`);
    if (meta.get('format') !== LEARNED_FORMAT) errors.push(`biçim sürümü beklenen değil: ${String(meta.get('format'))}`);
    if (region !== null && meta.get('region') !== region) errors.push(`il uyuşmuyor (dosya ${String(meta.get('region'))}, bölge ${region})`);
    const counts = { doors: number('SELECT COUNT(*) FROM door'), layouts: number('SELECT COUNT(*) FROM layout'), entrances: number('SELECT COUNT(*) FROM entrance'), hints: number('SELECT COUNT(*) FROM hint') };
    if (Number(meta.get('doors')) !== counts.doors) errors.push(`kapı sayısı uyuşmuyor (meta ${String(meta.get('doors'))}, tablo ${counts.doors})`);
    if (Number(meta.get('layouts')) !== counts.layouts) errors.push(`bina düzeni sayısı uyuşmuyor (meta ${String(meta.get('layouts'))}, tablo ${counts.layouts})`);

    let badKeys = 0;
    let outside = 0;
    for (const row of all('SELECT key, lng, lat, trusted, sources, spread FROM door')) {
      const key = String(row.key);
      if (!validKey(key, region ?? key.split('|')[0] ?? '')) badKeys++;
      if (row.trusted !== 0 && row.trusted !== 1) errors.push(`trusted 0 ya da 1 olmalı: ${key}`);
      if (Number(row.sources) < 1 || Number(row.sources) > MAX_SOURCES || Number(row.spread) < 0 || Number(row.spread) > 1000) errors.push(`kaynak sayısı ya da yayılım aralık dışı: ${key}`);
      if (bbox && (Number(row.lng) < (bbox[0] as number - pad) * 1e6 || Number(row.lng) > (bbox[2] as number + pad) * 1e6 || Number(row.lat) < (bbox[1] as number - pad) * 1e6 || Number(row.lat) > (bbox[3] as number + pad) * 1e6)) outside++;
    }
    if (badKeys > 0) errors.push(`${badKeys} kapı anahtarı geçersiz`);
    if (outside > 0) errors.push(`${outside} kapı bölgenin dışında`);

    const badLayouts = number("SELECT COUNT(*) FROM layout WHERE per < 0 OR per > 16 OR basement < 0 OR basement > 10 OR floors < -10 OR floors > 80 OR fit < 0 OR fit > 100 OR samples < 3");
    if (badLayouts > 0) errors.push(`${badLayouts} bina düzeni aralık dışı`);
    for (const row of all('SELECT key, ranges FROM layout')) {
      try {
        const parsed: unknown = JSON.parse(String(row.ranges));
        if (!Array.isArray(parsed) || parsed.some((r) => !Array.isArray(r) || r.length !== 3 || r.some((n) => !Number.isInteger(n)))) throw new Error('shape');
      } catch {
        errors.push(`kat aralıkları okunamadı: ${String(row.key)}`);
      }
    }
    const dangling = number('SELECT COUNT(*) FROM layout WHERE substr(key, 1, CASE WHEN instr(key, \'#\') > 0 THEN instr(key, \'#\') - 1 ELSE length(key) END) NOT IN (SELECT key FROM door)') + number('SELECT COUNT(*) FROM entrance WHERE substr(key, 1, CASE WHEN instr(key, \'#\') > 0 THEN instr(key, \'#\') - 1 ELSE length(key) END) NOT IN (SELECT key FROM door)');
    if (dangling > 0) errors.push(`${dangling} bina düzeni ya da giriş olmayan bir kapıya bağlı`);

    const badOrigins = number('SELECT COUNT(*) FROM hint WHERE origin NOT IN (0, 1)') + number('SELECT COUNT(*) FROM door WHERE origin NOT IN (0, 1)');
    if (badOrigins > 0) errors.push(`${badOrigins} satırın kaynağı (origin) 0 ya da 1 değil`);
    const strayWays = number('SELECT COUNT(*) FROM way WHERE NOT EXISTS (SELECT 1 FROM hint WHERE hint.district = way.district AND hint.name = way.name)');
    if (strayWays > 0) errors.push(`${strayWays} sokak çizgisi bir ipucuna bağlı değil`);
    let badWays = 0;
    for (const row of all('SELECT line, doors FROM way')) {
      try {
        const line: unknown = JSON.parse(String(row.line));
        const doors: unknown = JSON.parse(String(row.doors));
        if (!Array.isArray(line) || line.length < 2 || line.length > 200 || line.some((q) => !Array.isArray(q) || q.length !== 2 || q.some((n) => !Number.isInteger(n)))) throw new Error('shape');
        if (!Array.isArray(doors) || doors.length > 100 || doors.some((q) => !Array.isArray(q) || q.length !== 2 || q.some((n) => !Number.isInteger(n)))) throw new Error('shape');
      } catch {
        badWays++;
      }
    }
    if (badWays > 0) errors.push(`${badWays} sokak çizgisi okunamadı`);

    let personal = 0;
    for (const [table, column] of [['door', 'key'], ['layout', 'key'], ['entrance', 'key'], ['hint', 'name'], ['hint', 'district'], ['way', 'name']] as const) {
      for (const row of all(`SELECT ${column} AS v FROM ${table}`)) if (hasPersonalData(String(row.v))) personal++;
    }
    if (personal > 0) errors.push(`${personal} metinde telefon, e-posta ya da kimlik numarası kalıbı var`);
    return { errors, counts };
  } finally {
    db.close();
  }
}
