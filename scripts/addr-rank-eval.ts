import { pathToFileURL } from 'node:url';
import { distanceM } from '../src/core/geo/distance';
import { recordMeasure } from '../tools/compare/measures';
import { openSearch } from './addr-eval';
import { readSet, type TextRecord } from './addr-sets';

const HIT_M = 50;
const PLATES = ['06', '16', '34', '35', '41'];
const pct = (part: number, whole: number): number => (whole === 0 ? 0 : Number(((100 * part) / whole).toFixed(1)));

export async function rankStats(set: string, limit: number, key?: string): Promise<{ n: number; first: number; top3: number; top8: number; inBest: number }> {
  const search = await openSearch();
  let n = 0;
  let first = 0;
  let top3 = 0;
  let top8 = 0;
  const misses: string[] = [];
  for (const plate of PLATES) {
    for (const r of readSet<TextRecord>(set, plate).slice(0, limit)) {
      const result = await search.resolve(r.text, { limit: 8 });
      const list = result.status === 'region_missing' ? [] : result.candidates;
      const at = list.findIndex((c) => distanceM(c.coordinate, [r.lng, r.lat]) <= HIT_M);
      n++;
      if (at === 0) first++;
      else if (misses.length < Number(process.env.MISSES ?? 0)) misses.push(`${at < 0 ? 'yok' : `sıra ${at + 1}`} | ${r.text} | ${r.ops.join(',')} → ${list[0]?.label ?? '-'} [${list[0]?.precision}]`);
      if (at >= 0 && at < 3) top3++;
      if (at >= 0) top8++;
    }
    search.invalidate(plate);
  }
  for (const m of misses) console.log('  ', m);
  const out = { n, first: pct(first, n), top3: pct(top3, n), top8: pct(top8, n), inBest: pct(top8 - first, n) };
  console.log(`${set}: ${n} kayıt, ilk sırada (≤${HIT_M} m) %${out.first}, ilk 3 %${out.top3}, ilk 8 %${out.top8}; ilk sırada olmayıp ilk 8'de olan %${out.inBest}`);
  if (key) recordMeasure(key, { set, ...out });
  return out;
}

async function main(): Promise<void> {
  const set = process.argv[2] ?? 'g1s';
  await rankStats(set, Number(process.argv[3] ?? 1000), process.env.RANK_KEY);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
