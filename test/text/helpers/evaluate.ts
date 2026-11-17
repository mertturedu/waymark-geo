import { nameKey } from '../../../src/core/text/fold';
import { streetKey } from '../../../src/core/text/street';
import type { ParsedAddress } from '../../../src/core/text/types';
import type { Expect } from './types';

const squash = (text: string): string => nameKey(text).split(' ').join('');
const collapse = (text: string): string => {
  let out = '';
  for (const ch of squash(text)) if (ch !== out.charAt(out.length - 1) || /\d/.test(ch)) out += ch;
  return out;
};

export type Verdict = { ok: boolean; wrong: string[] };

export function evaluate(parsed: ParsedAddress, expected: Expect, loose: boolean): Verdict {
  const wrong: string[] = [];
  const same = (a: string | null | undefined, b: string): boolean => (a ? (loose ? collapse(a) === collapse(b) : squash(a) === squash(b)) : false);
  if (expected.province !== undefined && parsed.province?.id !== expected.province) wrong.push('province');
  const districtOk = same(parsed.district?.name, expected.district ?? '') && (expected.districtPlate === undefined || parsed.district?.plate === expected.districtPlate || parsed.district?.ambiguous === true);
  if (expected.district !== undefined && !districtOk) wrong.push('district');
  if (expected.postcode !== undefined && parsed.postcode !== expected.postcode) wrong.push('postcode');
  if (expected.neighbourhood !== undefined && !same(parsed.neighbourhood, expected.neighbourhood)) wrong.push('neighbourhood');
  const wanted = streetKey(expected.street);
  const street = parsed.street;
  const streetOk = street !== null && (loose ? collapse(street.key) === collapse(wanted.key) || street.compact === wanted.compact : street.compact === wanted.compact || street.key.split(' ').join('') === wanted.key.split(' ').join(''));
  if (!streetOk) wrong.push('street');
  if (!same(parsed.houseNumber, expected.houseNumber)) wrong.push('houseNumber');
  if (expected.door !== undefined && !same(parsed.door, expected.door)) wrong.push('door');
  if (expected.floor !== undefined && !same(parsed.floor, expected.floor)) wrong.push('floor');
  if (expected.block !== undefined && !same(parsed.block, expected.block)) wrong.push('block');
  return { ok: wrong.length === 0, wrong };
}
