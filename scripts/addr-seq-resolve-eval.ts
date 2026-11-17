import { pathToFileURL } from 'node:url';
import { recordMeasure } from '../tools/compare/measures';
import { evalText, openSearch, stats } from './addr-eval';
import { readSet, type TextRecord } from './addr-sets';

async function main(): Promise<void> {
  const plates = (process.argv[2] ?? '06,35,16,41').split(',');
  const limit = Number(process.argv[3] ?? 600);
  const label = process.env.BUILD2 ?? 'taban';
  const errors: number[] = [];
  const guessed: number[] = [];
  const notes = { outOfRange: 0, entrance: 0, interpolated: 0 };
  for (const plate of plates) {
    const search = await openSearch(undefined, false, [plate]);
    for (const r of readSet<TextRecord>('g2', plate).filter((x) => x.source === 'business').slice(0, limit)) {
      const o = await evalText(search, r);
      errors.push(o.errorM);
      if (o.precision === 'interpolated') {
        notes.interpolated++;
        guessed.push(o.errorM);
      }
    }
    search.invalidate(plate);
  }
  const s = stats(errors);
  console.log(`[${label}] işletme kapıları, dizin kapalı: ${s.count} kayıt, ortanca ${s.median} m, p90 ${s.p90} m, ≤15 m %${s.within15}, ≤30 m %${s.within30}, ≤50 m %${s.within50}; interpolasyon sonucu ${notes.interpolated}`);
  const g = stats(guessed);
  console.log(`[${label}] yalnız interpolasyon sonuçları: ${g.count} kayıt, ortanca ${g.median} m, p90 ${g.p90} m, ≤30 m %${g.within30}`);
  recordMeasure(`a6_business_${label}`, { plates, ...s, interpolated: notes.interpolated, guessed: g });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
