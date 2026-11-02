type Cls = 'ones' | 'teens' | 'tens' | 'hundred' | 'thousand';
type Word = { value: number; cls: Cls; ordinal: boolean };

export function toAsciiDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (code >= 0x660 && code <= 0x669) out += String.fromCharCode(code - 0x660 + 48);
    else if (code >= 0x6f0 && code <= 0x6f9) out += String.fromCharCode(code - 0x6f0 + 48);
    else if (code >= 0xff10 && code <= 0xff19) out += String.fromCharCode(code - 0xff10 + 48);
    else out += ch;
  }
  return out;
}

const WORDS = new Map<string, Word>();
const add = (list: string, values: number[], cls: Cls, ordinal: boolean): void => {
  list.split(' ').forEach((word, index) => WORDS.set(word, { value: values[index] as number, cls, ordinal }));
};
const range = (from: number, count: number, step = 1): number[] => Array.from({ length: count }, (_, i) => from + i * step);

add('bir iki uc dort bes alti yedi sekiz dokuz', range(1, 9), 'ones', false);
add('on yirmi otuz kirk elli altmis yetmis seksen doksan', range(10, 9, 10), 'tens', false);
add('yuz', [100], 'hundred', false);
add('bin', [1000], 'thousand', false);
add('birinci ikinci ucuncu dorduncu besinci altinci yedinci sekizinci dokuzuncu', range(1, 9), 'ones', true);
add('onuncu yirminci otuzuncu kirkinci ellinci altmisinci yetmisinci sekseninci doksaninci', range(10, 9, 10), 'tens', true);
add('yuzuncu', [100], 'hundred', true);
add('bininci', [1000], 'thousand', true);
add('one two three four five six seven eight nine', range(1, 9), 'ones', false);
add('ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen', range(10, 10), 'teens', false);
add('twenty thirty forty fifty sixty seventy eighty ninety', range(20, 8, 10), 'tens', false);
add('hundred', [100], 'hundred', false);
add('thousand', [1000], 'thousand', false);
add('first second third fourth fifth sixth seventh eighth ninth', range(1, 9), 'ones', true);
add('tenth eleventh twelfth thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth', range(10, 10), 'teens', true);
add('twentieth thirtieth fortieth fiftieth sixtieth seventieth eightieth ninetieth', range(20, 8, 10), 'tens', true);
add('hundredth', [100], 'hundred', true);
add('thousandth', [1000], 'thousand', true);

const ONES = 'bir iki uc dort bes alti yedi sekiz dokuz'.split(' ');
const ONES_ORDINAL = 'birinci ikinci ucuncu dorduncu besinci altinci yedinci sekizinci dokuzuncu'.split(' ');
const TENS = 'on yirmi otuz kirk elli altmis yetmis seksen doksan'.split(' ');
const TENS_ORDINAL = 'onuncu yirminci otuzuncu kirkinci ellinci altmisinci yetmisinci sekseninci doksaninci'.split(' ');

export function numberAsWords(value: number): string[] {
  if (!Number.isInteger(value) || value < 1 || value > 99) return [];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  if (tens === 0) return [ONES[ones - 1] as string, ONES_ORDINAL[ones - 1] as string];
  if (ones === 0) return [TENS[tens - 1] as string, TENS_ORDINAL[tens - 1] as string];
  return [`${TENS[tens - 1]} ${ONES[ones - 1]}`, `${TENS[tens - 1]} ${ONES_ORDINAL[ones - 1]}`];
}

const STREET_WORDS = 'sokak sokagi sk sok cadde caddesi cd cad bulvar bulvari blv yol yolu street st avenue ave road rd boulevard blvd'.split(' ');
const STRONG_MARKERS = new Set('no numara nr kat daire blok number floor apartment flat block'.split(' '));
const MARKERS = new Set([...STRONG_MARKERS, ...STREET_WORDS]);
const CONTEXT_AFTER = new Set([...STREET_WORDS, ...'kat floor mahalle mahallesi mah blok block'.split(' ')]);

const OPENS: Record<Cls, (Cls | null)[]> = {
  ones: [null, 'tens', 'hundred', 'thousand'],
  teens: [null, 'hundred', 'thousand'],
  tens: [null, 'hundred', 'thousand'],
  hundred: [null, 'ones', 'thousand'],
  thousand: [null, 'ones', 'tens', 'teens', 'hundred'],
};

type Run = { value: number; length: number; ordinal: boolean };

function readRun(tokens: string[], start: number): Run | null {
  let total = 0;
  let current = 0;
  let last: Cls | null = null;
  let length = 0;
  let ordinal = false;
  for (let i = start; i < tokens.length && !ordinal; i++) {
    const token = tokens[i] as string;
    if (token === 'and' && (last === 'hundred' || last === 'thousand') && WORDS.has(tokens[i + 1] ?? '')) {
      length++;
      continue;
    }
    const word = WORDS.get(token);
    if (!word || !OPENS[word.cls].includes(last)) break;
    if (word.cls === 'hundred') current = (current || 1) * 100;
    else if (word.cls === 'thousand') {
      total += (current || 1) * 1000;
      current = 0;
    } else current += word.value;
    last = word.cls;
    ordinal = word.ordinal;
    length++;
  }
  return length === 0 || last === null ? null : { value: total + current, length, ordinal };
}

export function numberWordsToDigits(text: string): string {
  const tokens = text.split(' ');
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const dotted = /^(\d+)\.$/.exec(token);
    const suffixed = /^(\d+)(st|nd|rd|th)$/.exec(token);
    if (dotted || suffixed) {
      out.push((dotted ?? suffixed)?.[1] as string);
      continue;
    }
    const run = WORDS.has(token) ? readRun(tokens, i) : null;
    if (run) {
      const previous = out[out.length - 1] ?? '';
      const next = tokens[i + run.length] ?? '';
      const endsRun = next === '' || MARKERS.has(next) || /^\d/.test(next);
      if (STRONG_MARKERS.has(previous) || (MARKERS.has(previous) && endsRun) || (run.ordinal && CONTEXT_AFTER.has(next))) {
        out.push(String(run.value));
        i += run.length - 1;
        continue;
      }
    }
    out.push(token);
  }
  return out.join(' ');
}
