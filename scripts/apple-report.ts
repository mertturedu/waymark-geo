import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './addr-sets';
import type { Judged } from './apple-judge';
import type { Raw } from './apple-judge';

const judgedDir = join(repoRoot, 'dist', 'apple', 'judged');
const rawDir = join(repoRoot, 'dist', 'apple', 'raw');
const jsonl = <T>(file: string): T[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : []);

const SETS = ['kapi', 'sokak', 'eksik', 'alan', 'ad'] as const;
const NAMES: Record<string, string> = { kapi: 'Kapı', sokak: 'Sokak', eksik: 'Eksik sokak', alan: 'Köy/mahalle', ad: 'Bina/işletme adı' };

const pct = (n: number, d: number): string => (d === 0 ? '-' : `%${((100 * n) / d).toFixed(1)}`);
const quantile = (list: number[], q: number): number | null => (list.length === 0 ? null : [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(q * list.length))]!);
const m = (v: number | null): string => (v === null ? '-' : `${Math.round(v)} m`);

export type Row = { judged: Judged[]; raw: Raw[] };

export function summarize(rows: Row): { lines: string[] } {
  const { judged, raw } = rows;
  const status = (set: string): { ok: number; n: number } => {
    const ids = new Set(judged.filter((j) => j.set === set).map((j) => j.id));
    const list = raw.filter((r) => ids.has(r.id));
    return { ok: list.filter((r) => r.status === 'ok').length, n: list.length };
  };
  const lines: string[] = ['| Küme | Sorgu | Apple cevap verdi | Apple daha iyi | Aynı | Biz daha iyi | Çakışma | Şüpheli | İkisi de yok | Kabul A/B/C |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const set of SETS) {
    const list = judged.filter((j) => j.set === set);
    if (list.length === 0) continue;
    const count = (c: string): number => list.filter((j) => j.cls === c).length;
    const st = status(set);
    const tiers = ['A', 'B', 'C'].map((t) => list.filter((j) => j.tier === t).length).join('/');
    lines.push(`| ${NAMES[set]} | ${list.length} | ${st.ok} (${pct(st.ok, st.n)}) | ${count('apple')} | ${count('ayni')} | ${count('biz')} | ${count('cakisma')} | ${count('supheli')} | ${count('ikisi-de-yok')} | ${tiers} |`);
  }
  return { lines };
}

export function accuracy(judged: Judged[]): string[] {
  const out: string[] = [];
  for (const [label, set] of [['Kapı (OSM doğru noktasına göre)', 'kapi'], ['Bina/işletme adı (rehber noktasına göre)', 'ad']] as const) {
    const list = judged.filter((j) => j.set === set && (j.tier === 'A' || j.tier === 'B') && j.errApple !== null);
    const apple = list.map((j) => j.errApple as number);
    const ours = judged.filter((j) => j.set === set && j.errOurs !== null).map((j) => j.errOurs as number);
    out.push(`| ${label} | ${list.length} | ${m(quantile(apple, 0.5))} | ${m(quantile(apple, 0.9))} | ${pct(apple.filter((e) => e <= 100).length, apple.length)} | ${ours.length} | ${m(quantile(ours, 0.5))} |`);
  }
  return out;
}

export function whyRejected(judged: Judged[]): string[] {
  const count = new Map<string, number>();
  for (const j of judged.filter((x) => x.cls === 'supheli')) {
    const key = `${j.set}: ${j.why.join('+') || '-'}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `| ${k} | ${n} |`);
}

function main(): void {
  const plates = Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0')).filter((p) => existsSync(join(judgedDir, `${p}.jsonl`)));
  const all: Judged[] = [];
  const allRaw: Raw[] = [];
  const perPlate: string[] = [];
  for (const plate of plates) {
    const judged = jsonl<Judged>(join(judgedDir, `${plate}.jsonl`));
    const raw = jsonl<Raw>(join(rawDir, `${plate}.jsonl`));
    all.push(...judged);
    allRaw.push(...raw);
    const c = (cls: string): number => judged.filter((j) => j.cls === cls).length;
    const ok = raw.filter((r) => r.status === 'ok').length;
    perPlate.push(`| ${plate} | ${judged.length} | ${pct(ok, raw.length)} | ${c('apple')} | ${c('ayni')} | ${c('biz')} | ${c('cakisma')} | ${c('supheli')} | ${pct(c('apple'), judged.length)} |`);
  }
  const total = summarize({ judged: all, raw: allRaw });
  const text = [
    '# Apple karşılaştırması: il ve küme sonuçları',
    '',
    `Güncelleme: ${new Date().toISOString()}. İl sayısı: ${plates.length}, sorgu: ${all.length}.`,
    '',
    'Sınıflar: **Apple daha iyi** (bizde cevap kaba ya da yanlış, Apple cevabı doğrulamadan geçti), **Aynı**, **Biz daha iyi**, **Çakışma** (ikisi de cevap verdi, farklı yerler, hangisi doğru belli değil), **Şüpheli** (Apple cevabı doğrulamadan geçmedi: başka sokak, ilçe, il ya da ad), **İkisi de yok**.',
    '',
    '## Toplam',
    '',
    ...total.lines,
    '',
    '## Doğruluk (doğru noktası bilinenlerde, Apple kabul A/B)',
    '',
    '| Ölçü | Örnek | Apple ortanca | Apple %90 | Apple 100 m içinde | Bizim örnek | Bizim ortanca |',
    '|---|---|---|---|---|---|---|',
    ...accuracy(all),
    '',
    '## Şüpheli sınıfının nedenleri',
    '',
    '| Küme: neden | Sayı |',
    '|---|---|',
    ...whyRejected(all),
    '',
    '## İl bazında',
    '',
    '| İl | Sorgu | Apple cevap verdi | Apple daha iyi | Aynı | Biz daha iyi | Çakışma | Şüpheli | Apple daha iyi oranı |',
    '|---|---|---|---|---|---|---|---|---|',
    ...perPlate,
    '',
  ].join('\n');
  writeFileSync(join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'faz-19', 'apple-karsilastirma-il.md'), text);
  console.log(text.split('\n').slice(0, 36).join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
