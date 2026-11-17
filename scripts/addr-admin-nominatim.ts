import { pathToFileURL } from 'node:url';
import { nameKey } from '../src/core/text';
import { nominatim } from '../tools/compare/engines/nominatim';
import { recordMeasure } from '../tools/compare/measures';
import { evalText, openSearch } from './addr-eval';
import { readSet, type TextRecord } from './addr-sets';

const hoodKey = (value: string): string => nameKey(value.toLocaleLowerCase('tr-TR').replace(/\s+(mahallesi|mahalle|mah\.?|mh\.?)$/, ''));

async function main(): Promise<void> {
  const plates = (process.argv[2] ?? '34,16,35,06').split(',');
  const limit = Number(process.argv[3] ?? 300);
  const search = await openSearch();
  const engine = nominatim();
  let total = 0;
  let sdkRight = 0;
  let rivalRight = 0;
  let rivalFound = 0;
  for (const plate of plates) {
    for (const r of readSet<TextRecord>('g2', plate).filter((x) => x.hood && !x.ops.includes('hood_drop') && !x.ops.includes('hood_typo') && !x.ops.includes('district_wrong')).slice(0, limit)) {
      total++;
      if ((await evalText(search, r)).hoodOk === true) sdkRight++;
      const found = await engine.query(`${r.hood} Mahallesi, ${r.district}, ${r.province}`);
      if (found.found) rivalFound++;
      const wanted = hoodKey(r.hood as string);
      if ((found.parts.hood && hoodKey(found.parts.hood) === wanted) || (found.parts.street === undefined && found.parts.district && hoodKey(found.parts.district) === wanted)) rivalRight++;
    }
    search.invalidate(plate);
  }
  const pct = (n: number): number => Number(((100 * n) / total).toFixed(1));
  const result = { count: total, sdk: pct(sdkRight), nominatim: pct(rivalRight), nominatimFound: pct(rivalFound) };
  console.log(`SDK (dağınık metin) mahalle doğru %${result.sdk}; Nominatim (temiz il/ilçe/mahalle) mahalle doğru %${result.nominatim} (buldu %${result.nominatimFound}); ${total} kayıt`);
  recordMeasure('a3_nominatim', result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
