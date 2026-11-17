import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { buildLearned } from '../pipeline/build/learned';
import type { LngLat } from '../src/core/geo/cells';
import type { StreetHint } from '../src/core/learned/types';
import { decodeRings } from '../src/core/region/geom';
import { nameKey } from '../src/core/text/fold';
import { streetKey } from '../src/core/text/street';
import { distanceM } from '../src/core/geo/distance';
import { repoRoot } from './addr-sets';
import { displayName, knownStreets } from './hints-geo';
import { addApple, appleHints, directoryStreets, appleWays, applyWays } from './apple-ingest';
import { mergeOverture, overtureHints } from './hints-overture';

export { displayName, knownStreets };

export type RawHint = { plate: string; district: string; hood: string; sid: string | null; street: string; key: string; sources?: number; source?: string; license?: string | null };
export type HoodGeo = { id: number; sid: string | null; name: string; district: string; centre: LngLat; radiusM: number };
export type Built = { plate: string; input: number; used: number; skipped: Record<string, number>; agreement: { n: number; found: number }; overture: { added: number; refined: number; conflicts: number }; apple: { added: number; skipped: number; ways: number } };

const MIN_RADIUS_M = 250;
const MAX_RADIUS_M = 4000;
const packs = join(repoRoot, 'dist', 'work', '261028', 'packs');
export const outDir = (plate: string): string => join(repoRoot, 'dist', 'hints', plate);
const jsonl = (file: string): RawHint[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as RawHint) : []);

const PRIVATE_PAGE = /vefat|cenaze|taziye|olum/i;

const MAH = '(?:mah|mahallesi|mahalle|mh|koyu|koy)?';
const GAP = '[\\s.,:;\\-/|()]{0,6}';
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function tight(quote: string, hood: string, street: string): boolean {
  const q = ` ${nameKey(quote)} `;
  const h = esc(nameKey(hood));
  const first = esc(nameKey(street).split(' ')[0] ?? '');
  if (h === '' || first === '') return false;
  const forward = new RegExp(`\\b${h} ${MAH}${GAP}${first}\\b`);
  const backward = new RegExp(`\\b${first}[a-z0-9 ]{0,40}?\\b(?:cd|cad|caddesi|sk|sok|sokak|sokagi|bulvari|blv)\\b${GAP}${h}\\b`);
  return forward.test(q) || backward.test(q);
}

type Evidence = RawHint & { quotes?: string[]; via?: string[]; pages?: string[] };

export function loadRaw(plate: string, gated = true, pending = false): RawHint[] {
  const dir = (name: string): Evidence[] => jsonl(join(repoRoot, 'dist', 'municipal', name, `${plate}.jsonl`)) as Evidence[];
  const sourced = (h: Evidence): boolean => (h.sources ?? 0) >= 2;
  const proven = (h: Evidence): boolean => !!h.via?.includes('kural') && (h.quotes ?? []).some((q) => tight(q, h.hood, h.street));
  const municipal = dir('hints').filter((h) => sourced(h) && (!gated || proven(h)));
  const lists = gated ? [] : dir('hints-lists').filter(sourced);
  const opendata = jsonl(join(repoRoot, 'dist', 'municipal', 'hints-opendata', `${plate}.jsonl`)).map((h) => ({ ...h, sources: 2 }));
  const waiting = pending ? (jsonl(join(repoRoot, 'dist', 'municipal', 'hints-opendata-pending', `${plate}.jsonl`)) as Evidence[]).map((h) => ({ ...h, source: 'bekleyen', sources: 2 })) : [];
  const publicOnly = (h: Evidence): boolean => !(h.pages ?? []).every((u) => PRIVATE_PAGE.test(u));
  return [...opendata, ...waiting, ...municipal.filter(publicOnly), ...lists.filter(publicOnly)];
}

export function hoodGeos(db: DatabaseSync): HoodGeo[] {
  const rows = db.prepare('SELECT h.id id, h.sid sid, h.name name, h.cx cx, h.cy cy, h.poly poly, d.name district FROM neighbourhood h JOIN district d ON d.id = h.district_id').all() as { id: number; sid: string | null; name: string; cx: number | null; cy: number | null; poly: Uint8Array | null; district: string }[];
  const out: HoodGeo[] = [];
  for (const r of rows) {
    if (r.cx === null || r.cy === null) continue;
    const centre: LngLat = [r.cx / 1e6, r.cy / 1e6];
    let radius = 800;
    if (r.poly && r.poly.length > 0) {
      const points = decodeRings(r.poly).flat(2) as unknown as LngLat[];
      const far = Math.max(0, ...points.filter((p) => Array.isArray(p)).map((p) => distanceM(centre, p)));
      if (far > 0) radius = far;
    }
    out.push({ id: r.id, sid: r.sid, name: r.name, district: r.district, centre, radiusM: Math.round(Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, radius))) });
  }
  return out;
}

export function selectHints(raw: RawHint[], hoods: HoodGeo[], known: ReturnType<typeof knownStreets>): { hints: StreetHint[]; skipped: Record<string, number>; agreement: { n: number; found: number } } {
  const bySid = new Map(hoods.filter((h) => h.sid).map((h) => [h.sid as string, h]));
  const hoodsWithStreets = new Set([...known.byHood].map((k) => Number(k.split('|')[0])));
  const skipped: Record<string, number> = {};
  const skip = (why: string): void => void (skipped[why] = (skipped[why] ?? 0) + 1);
  const agreement = { n: 0, found: 0 };
  const grouped = new Map<string, { hint: RawHint; hood: HoodGeo; sources: number }[]>();
  for (const h of raw) {
    const hood = h.sid ? bySid.get(h.sid) : undefined;
    if (!hood) {
      skip('mahalle konumu yok');
      continue;
    }
    const key = streetKey(h.street).key;
    if (key === '') {
      skip('sokak adı boş');
      continue;
    }
    if (hoodsWithStreets.has(hood.id)) {
      agreement.n++;
      if (known.byHood.has(`${hood.id}|${key}`)) agreement.found++;
    }
    if (known.byDistrict.has(`${nameKey(hood.district)}|${key}`)) {
      skip('pakette zaten var');
      continue;
    }
    const list = grouped.get(`${nameKey(hood.district)}|${key}`) ?? [];
    list.push({ hint: h, hood, sources: h.sources ?? 1 });
    grouped.set(`${nameKey(hood.district)}|${key}`, list);
  }
  const hints: StreetHint[] = [];
  for (const [, list] of grouped) {
    if (new Set(list.map((l) => l.hood.id)).size > 1) {
      skip('aynı ilçede birden çok mahallede');
      continue;
    }
    const { hint, hood } = list[0]!;
    hints.push({ district: nameKey(hood.district), name: displayName(hint.street), point: hood.centre, radiusM: hood.radiusM, sources: Math.max(...list.map((l) => l.sources)) });
  }
  return { hints: hints.sort((a, b) => (a.district + a.name < b.district + b.name ? -1 : 1)), skipped, agreement };
}

export async function buildPlate(plate: string): Promise<Built | null> {
  const file = join(packs, plate, 'address.sqlite');
  if (!existsSync(file)) return null;
  const raw = loadRaw(plate);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const selected = selectHints(raw, hoodGeos(db), knownStreets(db));
    const merged = mergeOverture(selected.hints, overtureHints(plate, new Set()));
    const off = process.env.APPLE === '0';
    const plain = off ? { hints: merged.hints, added: 0, skipped: 0 } : addApple(merged.hints, appleHints(plate), directoryStreets(join(packs, plate, 'directory.sqlite')));
    const waved = off ? { hints: plain.hints, replaced: 0, added: 0 } : applyWays(plain.hints, appleWays(plate));
    const apple = { hints: waved.hints, added: plain.added + waved.added, skipped: plain.skipped, ways: waved.replaced + waved.added };
    if (apple.hints.length === 0) return null;
    mkdirSync(outDir(plate), { recursive: true });
    await buildLearned({ plate, records: [], nowWeek: 0, outFile: join(outDir(plate), 'learned.sqlite'), extraHints: apple.hints });
    const target = join(packs, plate, 'learned.sqlite');
    copyFileSync(join(outDir(plate), 'learned.sqlite'), `${target}.tmp`);
    renameSync(`${target}.tmp`, target);
    return { plate, input: raw.length, used: apple.hints.length, skipped: selected.skipped, agreement: selected.agreement, overture: { added: merged.added, refined: merged.refined, conflicts: merged.conflicts }, apple: { added: apple.added, skipped: apple.skipped, ways: apple.ways } };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((a) => /^\d{2}$/.test(a));
  const plates = only.length ? only : Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
  const built: Built[] = [];
  for (const plate of plates) {
    const b = await buildPlate(plate);
    if (b) {
      built.push(b);
      console.log(JSON.stringify(b));
    }
  }
  const sum = built.reduce((m, b) => ({ input: m.input + b.input, used: m.used + b.used, n: m.n + b.agreement.n, found: m.found + b.agreement.found, added: m.added + b.overture.added, refined: m.refined + b.overture.refined, conflicts: m.conflicts + b.overture.conflicts, apple: m.apple + b.apple.added, ways: m.ways + b.apple.ways }), { input: 0, used: 0, n: 0, found: 0, added: 0, refined: 0, conflicts: 0, apple: 0, ways: 0 });
  const lines = built.map((b) => `| ${b.plate} | ${b.input} | ${b.used} | ${Object.entries(b.skipped).map(([k, v]) => `${k}: ${v}`).join(', ')} | ${b.agreement.n ? `%${((100 * b.agreement.found) / b.agreement.n).toFixed(1)} (${b.agreement.n})` : '-'} |`);
  writeFileSync(join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'faz-19', 'ipucu-paketleri.md'), `# Sokak ipucu paketleri\n\nGüncelleme: ${new Date().toISOString()}\n\nToplam: ${sum.input} kanıt, ${sum.used} sokak ipucu pakete girdi (Overture işletme adreslerinden eklenen ${sum.added}, belediye/açık veri ipucunu iyileştiren ${sum.refined}, çelişen ve atlanan ${sum.conflicts}, Apple kaynaklı yeni ${sum.apple}, Apple ile çizgi ve kapı örneği kurulan ${sum.ways}). Uyum (OSM sokağı olan mahallelerde ipucu sokağının OSM'de de bulunma oranı): ${sum.n ? ((100 * sum.found) / sum.n).toFixed(1) : '-'}% (${sum.n} örnek).\n\n| İl | Kanıt | İpucu | Atlanan | Uyum |\n|---|---|---|---|---|\n${lines.join('\n')}\n`);
  console.log(JSON.stringify(sum));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
