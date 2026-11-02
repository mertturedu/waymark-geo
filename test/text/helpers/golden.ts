import { parseAddress } from '../../../src/core/text/parse';
import type { ParsedAddress } from '../../../src/core/text/types';
import { evaluate } from './evaluate';
import type { Expect } from './types';

export type HandExpect = Partial<{
  province: string | null;
  district: string | null;
  districtAmbiguous: boolean;
  neighbourhood: string | null;
  street: string | null;
  streetKind: string | null;
  houseNumber: string | null;
  door: string | null;
  floor: string | null;
  block: string | null;
  building: string | null;
  postcode: string | null;
  poiName: string | null;
  language: string | null;
}>;

export type GoldenCase =
  | { id: string; source: 'hand'; lang: string; text: string; expect: HandExpect }
  | { id: string; source: 'osm'; lang: string; province: string; text: string; expect: Expect };

export type GoldenFile = { version: 1; cases: GoldenCase[]; excluded: { generated: number; reason: string } };

export function handMismatch(parsed: ParsedAddress, expect: HandExpect): string[] {
  const actual: Record<string, unknown> = {
    province: parsed.province?.id ?? null,
    district: parsed.district?.name ?? null,
    districtAmbiguous: parsed.district?.ambiguous ?? false,
    neighbourhood: parsed.neighbourhood,
    street: parsed.street?.key ?? null,
    streetKind: parsed.street?.kind ?? null,
    houseNumber: parsed.houseNumber,
    door: parsed.door,
    floor: parsed.floor,
    block: parsed.block,
    building: parsed.building,
    postcode: parsed.postcode,
    poiName: parsed.poiName,
    language: parsed.language,
  };
  return Object.entries(expect)
    .filter(([key, value]) => actual[key] !== value)
    .map(([key]) => key);
}

export function runCase(entry: GoldenCase): { ok: boolean; wrong: string[] } {
  const parsed = parseAddress(entry.text);
  if (entry.source === 'hand') {
    const wrong = handMismatch(parsed, entry.expect);
    return { ok: wrong.length === 0, wrong };
  }
  return evaluate(parsed, entry.expect, entry.lang === 'ru' || entry.lang === 'el' || entry.lang === 'ar');
}

export function runGolden(cases: GoldenCase[]): { total: number; failed: { id: string; text: string; wrong: string[] }[] } {
  const failed: { id: string; text: string; wrong: string[] }[] = [];
  for (const entry of cases) {
    const verdict = runCase(entry);
    if (!verdict.ok) failed.push({ id: entry.id, text: entry.text, wrong: verdict.wrong });
  }
  return { total: cases.length, failed };
}
