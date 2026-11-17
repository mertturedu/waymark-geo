import { nameKey, truncateInput } from './fold';
import { LANGS, lookupWord } from './lexicon';
import { scriptOf } from './translit';
import type { Lang, WordKind } from './types';

export type StreetKey = {
  key: string;
  compact: string;
  loose: string;
  bare: BareKey;
  kind: WordKind | null;
  number: number | null;
  numberOnly: boolean;
  numbers: string[];
};

const STREET_KINDS: ReadonlySet<WordKind> = new Set(['sokak', 'cadde', 'bulvar', 'yol', 'cikmaz', 'meydan']);
const PREFIXES: ReadonlySet<string> = new Set('sehit gazi dr prof doc av mimar general orgeneral albay yarbay binbasi kaymakam hafiz haci molla seyh'.split(' '));
const MAX_NUMBER_DIGITS = 9;

const isDigits = (token: string): boolean => /^\d+$/.test(token);

function preferredLangs(name: string): readonly Lang[] {
  switch (scriptOf(name)) {
    case 'cyrillic':
      return ['ru'];
    case 'greek':
      return ['el'];
    case 'arabic':
      return ['ar'];
    default:
      return LANGS;
  }
}

function collapseDoubles(text: string): string {
  let out = '';
  for (const ch of text) if (ch !== out.charAt(out.length - 1) || isDigits(ch)) out += ch;
  return out;
}

const emptyShape = { key: '', compact: '', loose: '' };

export type BareKey = { key: string; compact: string; loose: string };

export function streetKey(name: string): StreetKey {
  const preferred = preferredLangs(name);
  const all = nameKey(truncateInput(name)).split(' ').filter(Boolean);
  const kindOf = (token: string): WordKind | null => {
    const hit = lookupWord(token, preferred);
    return hit && STREET_KINDS.has(hit.kind) ? hit.kind : null;
  };
  const peel = (repeat: boolean) => {
    const tokens = [...all];
    let kind: WordKind | null = null;
    while (tokens.length > 1) {
      const last = kindOf(tokens[tokens.length - 1] as string);
      if (!last) break;
      kind ??= last;
      tokens.pop();
      if (!repeat) break;
    }
    while (tokens.length > 1) {
      const first = kindOf(tokens[0] as string);
      if (!first) break;
      kind ??= first;
      tokens.shift();
      if (!repeat) break;
    }
    let words = tokens.map((token) => (isDigits(token) ? token.replace(/^0+(?=\d)/, '') : token));
    if (words.some(isDigits)) words = words.filter((token) => isDigits(token) || lookupWord(token, preferred)?.kind !== 'numara');
    let start = 0;
    while (start < words.length - 1 && PREFIXES.has(words[start] as string)) start++;
    const compact = words.slice(start).join('');
    return { kind, words, compact, loose: collapseDoubles(compact.split('y').join('i')) };
  };
  const one = peel(false);
  const bare = peel(true);
  const numbers = one.words.filter(isDigits);
  const numberOnly = one.words.length === 1 && numbers.length === 1;
  return {
    key: one.words.join(' '),
    compact: one.compact,
    loose: one.loose,
    bare: bare.words.length === 0 ? emptyShape : { key: bare.words.join(' '), compact: bare.compact, loose: bare.loose },
    kind: one.kind,
    number: numberOnly && (numbers[0] as string).length <= MAX_NUMBER_DIGITS ? Number(numbers[0]) : null,
    numberOnly,
    numbers,
  };
}

export function sameStreet(a: string, b: string): boolean {
  const left = streetKey(a);
  const right = streetKey(b);
  if (left.key === '' || right.key === '') return false;
  if (left.numbers.join(',') !== right.numbers.join(',')) return false;
  const sameScript = scriptOf(a) === scriptOf(b);
  if (sameScript && left.numberOnly && right.numberOnly && left.kind && right.kind && left.kind !== right.kind) return false;
  if (left.bare.key === right.bare.key || left.bare.key.split(' ').join('') === right.bare.key.split(' ').join('')) return true;
  return !sameScript && left.bare.loose === right.bare.loose;
}

const KIND_WORD: Partial<Record<WordKind, string>> = { sokak: 'Sokak', cadde: 'Caddesi', bulvar: 'Bulvarı', yol: 'Yolu', cikmaz: 'Çıkmaz', meydan: 'Meydanı' };

const capital = (word: string): string => {
  const code = word.charCodeAt(0);
  return code >= 97 && code <= 122 ? String.fromCharCode(code - 32) + word.slice(1) : word;
};

export function streetLabel(street: { key: string; kind: WordKind | null }): string {
  if (street.key === '') return '';
  const name = street.key.split(' ').map(capital).join(' ');
  const kind = street.kind ? KIND_WORD[street.kind] : undefined;
  return kind ? `${name} ${kind}` : name;
}
