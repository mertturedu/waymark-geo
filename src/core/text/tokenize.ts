import { toAsciiDigits } from './digits';
import { foldText, truncateInput } from './fold';
import { transliterate } from './translit';

export type Token = { t: string; seg: number; dotted: boolean };

const CAMEL = /([a-zçğıöşü])([A-ZÇĞİÖŞÜ])/g;
const SPACED_SLASH = /(\d) +\/ *(\d)|(\d) *\/ +(\d)/g;
const isDigit = (code: number): boolean => code >= 48 && code <= 57;
const isWordCode = (code: number): boolean => (code >= 97 && code <= 122) || isDigit(code) || (code >= 0x621 && code <= 0x64a) || (code >= 0x671 && code <= 0x6d3);

function soleLetterAfter(chars: string[], from: number): boolean {
  const first = (chars[from] ?? ' ').codePointAt(0) as number;
  const second = (chars[from + 1] ?? ' ').codePointAt(0) as number;
  return first >= 97 && first <= 122 && !isWordCode(second) && second !== 47;
}

function wordsOf(text: string): { word: string; dotted: boolean }[] {
  const out: { word: string; dotted: boolean }[] = [];
  const chars = Array.from(text);
  let current = '';
  const flush = (dotted: boolean) => {
    if (current !== '') out.push({ word: current, dotted });
    current = '';
  };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string;
    const code = ch.codePointAt(0) as number;
    const next = (chars[i + 1] ?? ' ').codePointAt(0) as number;
    const previous = current === '' ? 0 : (current.codePointAt(current.length - 1) as number);
    if (isWordCode(code)) current += ch;
    else if (ch === '/' && current !== '' && isWordCode(next) && (isDigit(previous) || isDigit(next))) current += ch;
    else if (ch === '-' && current !== '' && isDigit(previous) && (isDigit(next) || soleLetterAfter(chars, i + 1))) current += ch;
    else flush(ch === '.' && /^\d+$/.test(current));
  }
  flush(false);
  return out;
}

export function tokenize(raw: string): Token[] {
  const tokens: Token[] = [];
  let seg = 0;
  for (const part of truncateInput(raw).split(/[,;\n\r|\u2028\u2029\u060C\uFF0C\uFF1B]+/)) {
    const words = wordsOf(transliterate(toAsciiDigits(foldText(part.replace(CAMEL, '$1 $2')))).replace(SPACED_SLASH, (_, a: string | undefined, b: string | undefined, c: string | undefined, d: string | undefined) => `${a ?? c}/${b ?? d}`));
    for (const { word, dotted } of words) tokens.push({ t: word, seg, dotted });
    if (words.length > 0) seg++;
  }
  return tokens;
}
