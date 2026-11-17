import { streetKey } from './street';
import type { ParsedAddress } from './types';

const MAX_HOOD_WORDS = 3;
const COMPOUND = /^(\d+)\/(\d+)$/;

export function alternativesOf(parsed: ParsedAddress): ParsedAddress[] {
  const out: ParsedAddress[] = [];
  const compound = parsed.houseNumber === null ? null : COMPOUND.exec(parsed.houseNumber);
  if (compound && parsed.door === null) out.push({ ...parsed, houseNumber: compound[1] as string, door: compound[2] as string, alternatives: [] });
  const extra = parsed.leftover[0];
  if (parsed.houseNumber !== null && /^\d+$/.test(parsed.houseNumber) && extra !== undefined && /^\d+$/.test(extra)) {
    const rest = parsed.leftover.slice(1);
    out.push({ ...parsed, door: parsed.door ?? extra, leftover: rest, alternatives: [] });
    out.push({ ...parsed, houseNumber: `${parsed.houseNumber}/${extra}`, leftover: rest, alternatives: [] });
  }
  if (parsed.street === null && parsed.neighbourhood !== null) {
    const words = parsed.neighbourhood.split(' ');
    for (let keep = 1; keep <= Math.min(MAX_HOOD_WORDS, words.length - 1); keep++) {
      const text = words.slice(0, words.length - keep).join(' ');
      const key = streetKey(text);
      out.push({ ...parsed, neighbourhood: words.slice(words.length - keep).join(' '), street: { text, key: key.key, compact: key.compact, kind: null, number: key.number }, alternatives: [] });
    }
  }
  return out;
}
