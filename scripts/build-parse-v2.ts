import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseAddress } from '../src/core/text';
import { summaryOf, type ParseSummary } from '../src/core/text/summary';
import { readSet, repoRoot, setsDir, type TextRecord } from './addr-sets';

export const PLATES = ['06', '10', '16', '20', '34', '35', '38', '41', '42', '45', '58', '59'];
export const PER_PLATE = 250;

export type ParseCase = {
  id: string;
  text: string;
  truth: { street: string; number: string; hood: string | null; district: string; province: string; unit?: { floor?: string; door?: string; block?: string } };
  expect: ParseSummary;
};

export function buildCases(): ParseCase[] {
  const out: ParseCase[] = [];
  for (const plate of PLATES) {
    const records = readSet<TextRecord>('g2', plate);
    const withUnit = records.filter((r) => r.unit);
    const plain = records.filter((r) => !r.unit);
    const step = (list: TextRecord[], count: number): TextRecord[] => list.filter((_, i) => i % Math.max(1, Math.floor(list.length / count)) === 0).slice(0, count);
    for (const r of [...step(withUnit, Math.floor(PER_PLATE * 0.4)), ...step(plain, PER_PLATE - Math.floor(PER_PLATE * 0.4))]) {
      out.push({ id: r.id, text: r.text, truth: { street: r.street, number: r.number, hood: r.hood, district: r.district, province: r.province, ...(r.unit ? { unit: r.unit } : {}) }, expect: summaryOf(parseAddress(r.text)) });
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cases = buildCases();
  const text = JSON.stringify({ note: 'G2 örnekleri; expect alanı ayrıştırıcının çıktısıdır (gerileme koruması), truth alanı üretilen kapının gerçek bileşenleri', cases });
  writeFileSync(join(repoRoot, 'fixtures', 'parse-v2.json'), text);
  mkdirSync(join(setsDir(), 'device'), { recursive: true });
  writeFileSync(join(setsDir(), 'device', 'parse-v2.json'), text);
  console.log(`${cases.length} vaka, ${cases.filter((c) => c.truth.unit).length} birimli`);
}
