import type { ParsedAddress } from './types';

export type ParseSummary = {
  province: string | null;
  district: string | null;
  hood: string | null;
  street: string | null;
  number: string | null;
  floor: string | null;
  door: string | null;
  block: string | null;
  building: string | null;
  dropped: string[];
  alternatives: number;
};

export const summaryOf = (p: ParsedAddress): ParseSummary => ({
  province: p.province?.id ?? null,
  district: p.district?.id ?? null,
  hood: p.neighbourhood,
  street: p.street?.key ?? null,
  number: p.houseNumber,
  floor: p.floor,
  door: p.door,
  block: p.block,
  building: p.building,
  dropped: p.dropped,
  alternatives: p.alternatives.length,
});
