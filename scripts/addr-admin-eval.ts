import { pathToFileURL } from 'node:url';
import { recordMeasure } from '../tools/compare/measures';
import { evalText, openSearch, type TextOutcome } from './addr-eval';
import { readSet, type TextRecord } from './addr-sets';

const share = (list: TextOutcome[], pick: (o: TextOutcome) => boolean | null): number => {
  const checked = list.filter((o) => pick(o) !== null);
  return checked.length === 0 ? 0 : (100 * checked.filter((o) => pick(o) === true).length) / checked.length;
};

export type AdminStats = { count: number; hood: number; district: number; street: number; within30: number };

export function adminStats(list: TextOutcome[]): AdminStats {
  return {
    count: list.length,
    hood: Number(share(list, (o) => o.hoodOk).toFixed(1)),
    district: Number(share(list, (o) => o.districtOk).toFixed(1)),
    street: Number(share(list, (o) => o.streetOk).toFixed(1)),
    within30: Number(((100 * list.filter((o) => o.errorM <= 30).length) / Math.max(1, list.length)).toFixed(1)),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string, fallback: string): string => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? (args[i + 1] as string) : fallback;
  };
  const plates = arg('plates', '34,16,35,06').split(',');
  const limit = Number(arg('limit', '2000'));
  const set = arg('set', 'g2');
  const search = await openSearch();
  const all: TextOutcome[] = [];
  for (const plate of plates) {
    for (const r of readSet<TextRecord>(set, plate).slice(0, limit)) all.push(await evalText(search, r));
    search.invalidate(plate);
  }
  const groups: [string, (o: TextOutcome) => boolean][] = [
    ['tümü', () => true],
    ['district_wrong', (o) => o.ops.includes('district_wrong')],
    ['district_drop', (o) => o.ops.includes('district_drop')],
    ['hood_typo', (o) => o.ops.includes('hood_typo')],
    ['hood_drop', (o) => o.ops.includes('hood_drop')],
    ['province_drop', (o) => o.ops.includes('province_drop')],
    ['street_typo', (o) => o.ops.includes('street_typo')],
    ['street_join', (o) => o.ops.includes('street_join')],
    ['kind_drop', (o) => o.ops.includes('kind_drop')],
    ['kind_swap', (o) => o.ops.includes('kind_swap')],
    ['kind_abbrev', (o) => o.ops.includes('kind_abbrev')],
    ['building', (o) => o.ops.includes('building')],
  ];
  const result: Record<string, AdminStats> = {};
  console.log('| Grup | Adet | Mahalle doğru | İlçe doğru | Sokak doğru | ≤30 m |\n|---|---|---|---|---|---|');
  for (const [name, test] of groups) {
    const s = adminStats(all.filter(test));
    result[name] = s;
    console.log(`| ${name} | ${s.count} | %${s.hood} | %${s.district} | %${s.street} | %${s.within30} |`);
  }
  if (args.includes('--record')) recordMeasure(arg('key', 'a3_base'), { set, plates, limit, groups: result });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
