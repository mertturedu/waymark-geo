import type { AdminNames } from '../../../src/core/text/types';

export type Expect = {
  province?: string;
  district?: string;
  districtPlate?: string;
  postcode?: string;
  neighbourhood?: string;
  street: string;
  houseNumber: string;
  door?: string;
  floor?: string;
  block?: string;
};

export type AddressRecord = {
  province: string;
  provinceName: string;
  district: string;
  districtNames: AdminNames;
  neighbourhood: string | null;
  neighbourhoodNames: Partial<AdminNames>;
  street: string;
  houseNumber: string;
};
