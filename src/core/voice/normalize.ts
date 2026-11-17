const ONES = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];

const ORDINAL: Record<string, string> = {
  bir: 'birinci',
  iki: 'ikinci',
  üç: 'üçüncü',
  dört: 'dördüncü',
  beş: 'beşinci',
  altı: 'altıncı',
  yedi: 'yedinci',
  sekiz: 'sekizinci',
  dokuz: 'dokuzuncu',
  on: 'onuncu',
  yirmi: 'yirminci',
  otuz: 'otuzuncu',
  kırk: 'kırkıncı',
  elli: 'ellinci',
  altmış: 'altmışıncı',
  yetmiş: 'yetmişinci',
  seksen: 'sekseninci',
  doksan: 'doksanıncı',
  yüz: 'yüzüncü',
  bin: 'bininci',
  milyon: 'milyonuncu',
  sıfır: 'sıfırıncı',
};

const ABBREVIATIONS: [RegExp, string][] = [
  [/\b[Cc]ad\./g, 'caddesi'],
  [/\b[Ss]k\./g, 'sokağı'],
  [/\b[Mm]ah\./g, 'mahallesi'],
  [/\b[Bb]lv\./g, 'bulvarı'],
  [/\b[Aa]pt\./g, 'apartmanı'],
  [/\b[Dd]r\./g, 'doktor'],
  [/\b[Nn]o\s*[:.]\s*(?=\d)/g, 'numara '],
];

const LETTER = 'A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû';

function below1000(n: number): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  if (h) out.push(...(h === 1 ? [] : [ONES[h] as string]), 'yüz');
  if (t) out.push(TENS[t] as string);
  if (o) out.push(ONES[o] as string);
  return out;
}

export function numberWords(n: number): string[] {
  if (n === 0) return ['sıfır'];
  const out: string[] = [];
  const groups: [number, string][] = [
    [1_000_000_000, 'milyar'],
    [1_000_000, 'milyon'],
    [1000, 'bin'],
  ];
  let rest = n;
  for (const [size, name] of groups) {
    const part = Math.floor(rest / size);
    rest %= size;
    if (!part) continue;
    if (!(size === 1000 && part === 1)) out.push(...below1000(part));
    out.push(name);
  }
  out.push(...below1000(rest));
  return out;
}

export function ordinalWords(n: number): string[] {
  const words = numberWords(n);
  const last = words[words.length - 1] as string;
  return [...words.slice(0, -1), ORDINAL[last] ?? last];
}

function digitsOnly(text: string): string {
  return text.split('').map((d) => numberWords(Number(d)).join(' ')).join(' ');
}

function spell(digits: string): string {
  if (digits.length > 9) return digitsOnly(digits);
  return numberWords(Number(digits)).join(' ');
}

const UNITS: [RegExp, string][] = [
  [/\bkm\b/g, 'kilometre'],
  [/\bkg\b/g, 'kilogram'],
  [/\bdk\b/g, 'dakika'],
  [/\bsn\b/g, 'saniye'],
  [/\bm\b/g, 'metre'],
  [/\bTL\b/g, 'lira'],
];

export function normalizeText(input: string): string {
  let text = input.replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"');
  for (const [pattern, word] of ABBREVIATIONS) text = text.replace(pattern, word);
  text = text.replace(/%\s*(\d+)/g, (_, d: string) => `yüzde ${spell(d)}`);
  text = text.replace(/\b(\d{1,2})[:.](\d{2})\b/g, (_, h: string, m: string) => (m === '00' ? spell(h) : `${spell(h)} ${spell(String(Number(m)))}`));
  text = text.replace(/(\d+),5\s*km\b/g, (_, d: string) => `${spell(d)} buçuk kilometre`);
  text = text.replace(/(\d+),5(?!\d)/g, (_, d: string) => `${spell(d)} buçuk`);
  text = text.replace(/(\d+),(\d+)/g, (_, a: string, b: string) => `${spell(a)} virgül ${digitsOnly(b)}`);
  text = text.replace(/(\d+)\s*([a-zA-Z]+)\b/g, (whole, d: string, unit: string) => {
    for (const [pattern, word] of UNITS) {
      pattern.lastIndex = 0;
      if (pattern.test(unit)) return `${spell(d)} ${word}`;
    }
    return whole;
  });
  text = text.replace(new RegExp(`(\\d+)\\.(?=\\s+[a-zçğıöşü])`, 'g'), (_, d: string) => (d.length > 9 ? spell(d) : ordinalWords(Number(d)).join(' ')));
  text = text.replace(new RegExp(`(\\d+)'([${LETTER}]+)`, 'g'), (_, d: string, suffix: string) => `${spell(d)}${suffix}`);
  text = text.replace(/\d+/g, (d) => spell(d));
  text = text.replace(new RegExp(`([${LETTER}])'([${LETTER}])`, 'g'), '$1$2');
  return text.replace(/\s+/g, ' ').trim();
}
