import { toAsciiDigits } from './digits';
import { foldText } from './fold';
import { transliterate } from './translit';

export type HouseNumber = { raw: string; key: string; int: number | null; suffix: string; parity: 'odd' | 'even' | null };

const MAX_NUMBER = 100;
const MAX_DIGITS = 6;

export function splitNumbers(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function houseNumberKey(raw: string): HouseNumber | null {
  if (raw.length > MAX_NUMBER) return null;
  const spaced = transliterate(foldText(toAsciiDigits(raw))).replace(/([0-9])[ .,]+(?=[0-9])/g, '$1/');
  const kept = spaced.replace(/[^a-z0-9/ء-ي-]/g, '');
  const key = kept.replace(/(^|[^0-9])0+(?=[0-9])/g, '$1');
  const run = /^[^0-9]*([0-9]+)/.exec(key);
  if (!run) return null;
  const digits = run[1] as string;
  const int = digits.length <= MAX_DIGITS ? Number(digits) : null;
  return { raw, key, int, suffix: key.slice(run[0].length), parity: int === null ? null : int % 2 === 0 ? 'even' : 'odd' };
}
