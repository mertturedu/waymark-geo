import type { Script } from './types';

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c', ш: 's', щ: 's', ъ: '', ы: 'i', ь: '', э: 'e',
  і: 'i', ї: 'i', є: 'e', ґ: 'g', ў: 'u', ә: 'a', ө: 'o', ү: 'u', қ: 'k', ғ: 'g', ң: 'n', һ: 'h',
};

const GREEK: Record<string, string> = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 't', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'ks', ο: 'o', π: 'p', ρ: 'r', σ: 's', τ: 't', υ: 'i', φ: 'f', χ: 'h', ψ: 'ps', ω: 'o', ϊ: 'y',
};

const GREEK_PAIRS: Record<string, string> = {
  ου: 'u', ει: 'i', οι: 'i', αι: 'e', υι: 'i', αυ: 'av', ευ: 'ev', ντ: 'd', μπ: 'b', γκ: 'g', γγ: 'ng', τσ: 'c', τζ: 'c',
};

const SILENT_IOTA = ['γκ'];

const GREEK_VOWELS = 'αεηιουω';

const CYRILLIC_VOWELS = 'аеёиоуыэюяіїєўәөү';

const isCyrillic = (ch: string): boolean => ch in CYRILLIC;

const SOFT_VOWELS: Record<string, [string, string]> = { ю: ['u', 'yu'], я: ['a', 'ya'], ё: ['o', 'o'], е: ['e', 'ye'] };
const isPlainConsonant = (ch: string): boolean => ch in CYRILLIC && !CYRILLIC_VOWELS.includes(ch);
const isGreek = (ch: string): boolean => ch in GREEK;

export function transliterate(text: string): string {
  const chars = Array.from(text);
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string;
    const pair = ch + (chars[i + 1] ?? '');
    if (chars[i] === 'ν' && chars[i + 1] === 'τ' && chars[i + 2] === 'ζ') {
      out += 'nc';
      i += 2;
    } else if (SILENT_IOTA.includes(pair) && chars[i + 2] === 'ι' && GREEK_VOWELS.includes(chars[i + 3] ?? ' ')) {
      out += GREEK_PAIRS[pair];
      i += 2;
    } else if (ch === 'γ' && chars[i + 1] === 'ι' && GREEK_VOWELS.includes(chars[i + 2] ?? ' ')) {
      out += 'y';
      i++;
    } else if (isGreek(ch)) {
      const mapped = GREEK_PAIRS[pair];
      if (mapped !== undefined) {
        out += mapped;
        i++;
      } else out += GREEK[ch];
    } else if (ch === 'д' && chars[i + 1] === 'ж') {
      out += 'c';
      i++;
    } else if (ch in SOFT_VOWELS) {
      const [afterConsonant, otherwise] = SOFT_VOWELS[ch] as [string, string];
      out += isPlainConsonant(chars[i - 1] ?? ' ') ? afterConsonant : otherwise;
    } else if (ch === 'ь' && CYRILLIC_VOWELS.includes(chars[i + 1] ?? ' ')) {
      out += 'y';
    } else if (isCyrillic(ch)) out += CYRILLIC[ch];
    else out += ch;
  }
  return out;
}

export function scriptOf(text: string): Script {
  const counts = { latin: 0, cyrillic: 0, greek: 0, arabic: 0 };
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 0xc0 && code <= 0x24f)) counts.latin++;
    else if (code >= 0x400 && code <= 0x4ff) counts.cyrillic++;
    else if (code >= 0x370 && code <= 0x3ff) counts.greek++;
    else if ((code >= 0x621 && code <= 0x64a) || (code >= 0x671 && code <= 0x6d3)) counts.arabic++;
  }
  const best = (Object.keys(counts) as (keyof typeof counts)[]).reduce((a, b) => (counts[b] > counts[a] ? b : a));
  return counts[best] === 0 ? 'other' : best;
}
