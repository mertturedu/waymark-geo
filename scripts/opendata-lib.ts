import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { nameKey } from '../src/core/text';
import { repoRoot } from './addr-sets';

export type Columns = { district: number | null; hood: number; street: number };
export type Table = string[][];

const OPEN = /^(cc-by(-sa)?(-\d(\.\d)?)?|cc-by-\d|cc-zero|cc0.*|odc-by|odc-odbl|odc-pddl|odc-.*|other-open|other-at|uk-ogl|gfdl|ibb-license)$/i;
const BAD_COLUMN = /\b(kod|kodu|id|sayi|sayisi|adet|uzunluk|tur|tip|no|numara|tarih|yil)\b/;

export const isOpenLicense = (id: string | null | undefined): boolean => !!id && OPEN.test(id.trim());

export function parseCsv(text: string): Table {
  const first = text.split('\n', 1)[0] ?? '';
  const delimiter = [';', '\t', ','].map((d) => ({ d, n: first.split(d).length })).sort((a, b) => b.n - a.n)[0]!.d;
  const rows: Table = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row.map((v) => v.trim()));
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row.map((v) => v.trim()));
  return rows;
}

export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1254').decode(bytes);
  }
}

export function detectColumns(header: string[]): Columns | null {
  const keys = header.map((h) => nameKey(h));
  const pick = (test: (k: string) => boolean): number | null => {
    const at = keys.findIndex((k) => test(k) && !BAD_COLUMN.test(k.replace(/\badi?\b/, '')));
    return at === -1 ? null : at;
  };
  const hood = pick((k) => /mahalle|mah |koy|\bkoy/.test(k + ' '));
  const street = pick((k) => /cadde|sokak|csbm|\byol\b|sk |cd /.test(k + ' '));
  const district = pick((k) => /\bilce\b|\bilce /.test(k + ' '));
  if (hood === null || street === null || hood === street) return null;
  return { district, hood, street };
}

export function readXlsx(file: string): Table {
  const unzip = (entry: string): string => {
    try {
      return execFileSync('unzip', ['-p', file, entry], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
    } catch {
      return '';
    }
  };
  const decode = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const shared = [...unzip('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const sheet = unzip('xl/worksheets/sheet1.xml');
  const rows: Table = [];
  for (const r of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of r[1]!.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? 'A';
      let col = 0;
      for (const ch of ref) col = col * 26 + (ch.charCodeAt(0) - 64);
      const body = c[2] ?? '';
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
      const text = /t="s"/.test(attrs) ? (shared[Number(value)] ?? '') : /t="inlineStr"/.test(attrs) ? decode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')) : decode(value);
      while (cells.length < col - 1) cells.push('');
      cells[col - 1] = text.trim();
    }
    if (cells.some((v) => v !== '')) rows.push(cells);
  }
  return rows;
}

const KIND_CELL = /^(cadde|caddesi|sokak|sokagi|bulvar|bulvari|meydan|meydani|cikmaz|cikmazi|yol)$/;

export function readXls(file: string): Table {
  try {
    const script = join(repoRoot, 'pipeline', 'extract', 'xls_to_json.py');
    const out = execFileSync(join(repoRoot, 'pipeline', '.venv', 'bin', 'python'), [script, file], { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out.toString('utf8')) as Table;
  } catch {
    return [];
  }
}

export function streetRows(table: Table): { district: string | null; hood: string; street: string }[] {
  for (let h = 0; h < Math.min(6, table.length); h++) {
    const cols = detectColumns(table[h] ?? []);
    if (!cols) continue;
    const out: { district: string | null; hood: string; street: string }[] = [];
    for (const row of table.slice(h + 1)) {
      const hood = (row[cols.hood] ?? '').trim();
      const base = (row[cols.street] ?? '').trim();
      const kind = [...row].reverse().find((cell) => cell.trim() !== '');
      const street = kind && kind !== base && KIND_CELL.test(nameKey(kind)) && !/\b(cadde|caddesi|sokak|sokagi|bulvar|bulvari|meydan|meydani|cikmaz|cikmazi)\b/.test(nameKey(base)) ? `${base} ${kind}` : base;
      if (!hood || !street || street.length > 80) continue;
      out.push({ district: cols.district === null ? null : (row[cols.district] ?? '').trim() || null, hood, street });
    }
    return out;
  }
  return [];
}

export function jsonTable(text: string): Table {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : ((data as { records?: unknown[]; result?: { records?: unknown[] } }).records ?? (data as { result?: { records?: unknown[] } }).result?.records ?? []);
  const objects = list.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));
  const first = objects[0];
  if (!first) return [];
  const header = Object.keys(first);
  return [header, ...objects.map((o) => header.map((h) => String(o[h] ?? '').trim()))];
}

export function titleLocation(title: string): { district: string; hood: string } | null {
  const m = /^(.+?) ilcesi (.+?) (?:mahallesi|mahalle|koyu)(?: |$)/.exec(nameKey(title));
  return m ? { district: m[1]!, hood: m[2]! } : null;
}

export function namedRows(table: Table, place: { district: string; hood: string }): { district: string | null; hood: string; street: string }[] {
  const header = (table[0] ?? []).map((h) => nameKey(h));
  const kind = header.findIndex((k) => /\b(tur|turu|tip|tipi)\b/.test(k));
  const named = header.findIndex((k) => /isim|\badi?\b|ad$/.test(k) && !/\b(tur|turu|tip|tipi)\b/.test(k));
  const name = named !== -1 ? named : header.findIndex((_, i) => i !== kind);
  if (name === -1) return [];
  const out: { district: string | null; hood: string; street: string }[] = [];
  for (const row of table.slice(1)) {
    const base = (row[name] ?? '').trim();
    const type = kind === -1 ? '' : (row[kind] ?? '').trim();
    if (!base || base.length > 70 || /^toplam$/i.test(nameKey(base))) continue;
    const street = type && !nameKey(base).endsWith(nameKey(type)) ? `${base} ${type}` : base;
    if (!/[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(street) && !type) continue;
    out.push({ district: place.district, hood: place.hood, street });
  }
  return out;
}
