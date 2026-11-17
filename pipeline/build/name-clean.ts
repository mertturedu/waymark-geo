import { editDistance } from '../../src/core/address/names';

export const KIND_WORDS = ['sokak', 'sokağı', 'sokağ', 'cadde', 'caddesi', 'bulvar', 'bulvarı', 'çıkmaz', 'çıkmazı', 'meydan', 'meydanı', 'yol', 'yolu', 'mahallesi', 'mahalle'];
const MIN_WORD = 5;

export type Cleaned = { name: string; changes: string[] };

const trTitle = (word: string): string => (word === '' ? word : word.charAt(0).replace('i', 'İ').replace('ı', 'I').toUpperCase() + word.slice(1).replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase());

export function cleanName(input: string): Cleaned {
  const changes: string[] = [];
  let name = input;
  const spaced = name.replace(/\s+/g, ' ').trim();
  if (spaced !== name) {
    changes.push('boşluk');
    name = spaced;
  }
  const letters = name.replace(/[^\p{L}]/gu, '');
  const upper = letters.length >= 4 && letters === letters.toLocaleUpperCase('tr') && letters !== letters.toLocaleLowerCase('tr');
  const lower = letters.length >= 4 && letters === letters.toLocaleLowerCase('tr');
  if (upper || lower) {
    const titled = name.split(' ').map(trTitle).join(' ');
    if (titled !== name) {
      changes.push(upper ? 'hepsi büyük harf' : 'hepsi küçük harf');
      name = titled;
    }
  }
  const words = name.split(' ');
  const last = words[words.length - 1] ?? '';
  const key = last.toLocaleLowerCase('tr');
  if (last.length >= MIN_WORD && !KIND_WORDS.includes(key)) {
    const near = KIND_WORDS.filter((k) => k.length >= MIN_WORD && editDistance(key, k, 1) <= 1);
    if (near.length === 1) {
      words[words.length - 1] = trTitle(near[0] as string);
      changes.push(`tür yazımı: ${last} → ${words[words.length - 1]}`);
      name = words.join(' ');
    }
  }
  return { name, changes };
}
