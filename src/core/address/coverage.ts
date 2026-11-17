export const COVERAGE_MIN_STREETS = 300;
export const COVERAGE_MIN_ADDRESSES = 30;

export type CoverageLevel = 'rich' | 'sparse';

export type Coverage = { region: string; district: string; streets: number; addresses: number; level: CoverageLevel };

export type HoodLabel = { region: string; name: string; lng: number; lat: number };

export const coverageLevel = (streets: number, addresses: number): CoverageLevel => (streets >= COVERAGE_MIN_STREETS && addresses >= COVERAGE_MIN_ADDRESSES ? 'rich' : 'sparse');

const SUFFIX = /\s+(Mahallesi|Mahalesi|Mah\.?)$/i;

export function shortHoodName(name: string): string {
  const short = name.replace(SUFFIX, '').trim();
  return short === '' ? name.trim() : short;
}
