import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runCase, type GoldenCase, type GoldenFile } from '../test/text/helpers/golden';
import { generateSentences } from '../test/text/helpers/sentence-generator';
import { foldText, nameKey } from '../src/core/text/fold';
import { HAND_CASES } from './golden-hand';
import type { AddressRecord } from './build-address-records';

const GENERATED = 2400;

export const UNICODE_INPUTS = [
  'İSTİKLAL Caddesi', 'Işık Sokağı', 'IĞDIR', 'ığdır', 'Çamlıca Şehitliği Üsküdar', 'Straße', 'Düsseldorf Öl Ärger', 'Zürich Ångström Œuvre Ærø',
  's\u0327', 'g\u0306', 'I\u0307stanbul', 'i\u0307stanbul', 'c\u0327ay u\u0308zeri', '\u200Fatat\u200Bürk\u200E', '\u202Eabc\u202C', '\uFEFFkadıköy', 'ata\u00adturk',
  'АТАТЮРК', 'Ататюрк', 'Кадыкёй', 'Бююк Чамлыджа', 'Ёмер', 'ΑΤΑΤΟΎΡΚ', 'Ατατούρκ', 'Χάταϊ ΪΪ', 'ΣΊΣΥΦΟΣ ς', 'Κετσιορεν', 'شَارِعٌ', 'أحمد إبراهيم آمنة', 'كـتاب', 'کتاب', 'علی',
  '٠١٢٣٤٥٦٧٨٩', '۰۱۲۳۴۵۶۷۸۹', '０１２３４５６７８９', '😀 Kadıköy', '\ud800a\udc00\ue000', 'a\u00a0b\u202fc\u3000d', '  çok   boşluk\t\n var ', '1707. Sokak', '4. Levent 2. Cadde', 'No:12/3, D.4!',
  'Hauptstraße 12', 'Marktplatz 3', 'ǅ ǆ Ǉ', 'ﬁ ﬂ', 'ǰ', 'Å Å', 'ß ẞ',
];
const SEED = 42;

export function buildGolden(records: AddressRecord[]): GoldenFile {
  const hand: GoldenCase[] = HAND_CASES.map(([lang, text, expect], i) => ({ id: `h${String(i + 1).padStart(3, '0')}`, source: 'hand', lang, text, expect }));
  const generated: GoldenCase[] = generateSentences(records, GENERATED, SEED).map((c, i) => ({
    id: `g${String(i + 1).padStart(4, '0')}`,
    source: 'osm',
    lang: c.lang,
    province: c.province,
    text: c.text,
    expect: c.expect,
  }));
  const kept = generated.filter((entry) => runCase(entry).ok);
  return {
    version: 1,
    cases: [...hand, ...kept],
    excluded: { generated: generated.length - kept.length, reason: 'sentences the parser does not read yet, counted by K1.5 but left out of the frozen table' },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { records } = JSON.parse(readFileSync('fixtures/address-records.json', 'utf8')) as { records: AddressRecord[] };
  const file = buildGolden(records);
  writeFileSync('fixtures/text-golden.json', JSON.stringify(file) + '\n');
  writeFileSync('fixtures/text-unicode.json', JSON.stringify({ version: 1, cases: UNICODE_INPUTS.map((text) => [text, foldText(text), nameKey(text)]) }) + '\n');
  const byLang = new Map<string, number>();
  for (const c of file.cases) byLang.set(c.lang, (byLang.get(c.lang) ?? 0) + 1);
  console.log(file.cases.length, 'cases', Object.fromEntries(byLang), 'excluded', file.excluded.generated);
}
