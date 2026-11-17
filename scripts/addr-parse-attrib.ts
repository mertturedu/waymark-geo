import { pathToFileURL } from 'node:url';
import { recordMeasure } from '../tools/compare/measures';
import { evaluate, wrongShare } from './addr-parse-eval';
import { evalText, openSearch } from './addr-eval';
import { readSet, type TextRecord } from './addr-sets';

async function main(): Promise<void> {
  const plates = (process.argv[2] ?? '34,16,35,06').split(',');
  const limit = Number(process.argv[3] ?? 800);
  const offset = 500;
  const search = await openSearch();
  let total = 0;
  let failed = 0;
  let attributable = 0;
  let wrongButFound = 0;
  for (const plate of plates) {
    const records = readSet<TextRecord>('g2', plate).slice(offset, offset + limit);
    const rows = evaluate(records);
    for (const row of rows) {
      const outcome = await evalText(search, row.record);
      const parseWrong = Object.values(row.best).some((v) => v === false);
      total++;
      if (outcome.errorM > 30) {
        failed++;
        if (parseWrong) attributable++;
      } else if (parseWrong) wrongButFound++;
    }
    search.invalidate(plate);
    console.log(`${plate}: ${rows.length} kayıt, ayrıştırma yanlış %${wrongShare(rows).toFixed(1)}`);
  }
  const share = (100 * attributable) / total;
  console.log(`toplam ${total}; çözümleme başarısız %${((100 * failed) / total).toFixed(1)}; ayrıştırma kaynaklı %${share.toFixed(1)}; ayrıştırma yanlış ama bulundu %${((100 * wrongButFound) / total).toFixed(1)}`);
  recordMeasure('a2_attrib', { plates, total, failedShare: Number(((100 * failed) / total).toFixed(1)), attributableShare: Number(share.toFixed(1)) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
