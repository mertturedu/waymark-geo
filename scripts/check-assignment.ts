import { findDistrict, findProvince } from '../src/core/text/admin';
import { nameKey } from '../src/core/text/fold';
import { cleanNeighbourhoodName } from '../pipeline/build/address-pack';

export type AddressForCheck = {
  id: string;
  plate: string;
  district: string;
  neighbourhood: string | null;
  hoodName: string | null;
  hoodSource: string;
  tags: Record<string, string>;
  lon: number;
  lat: number;
};

export type Tally = { agree: number; total: number };
export type Mismatch = { id: string; tag: string; assigned: string; lon: number; lat: number };
export type AssignmentCheck = {
  province: Tally;
  district: Tally;
  neighbourhood: Tally;
  hoodSources: Record<string, number>;
  skipped: { province: number; district: number };
  unofficialDistrict: number;
  mismatches: { province: Mismatch[]; district: Mismatch[]; neighbourhood: Mismatch[] };
};

type Names = { district(id: string): string | null; hood(id: string): string | null };
const EXAMPLES = 50;

export function emptyCheck(): AssignmentCheck {
  return {
    province: { agree: 0, total: 0 },
    district: { agree: 0, total: 0 },
    neighbourhood: { agree: 0, total: 0 },
    hoodSources: {},
    skipped: { province: 0, district: 0 },
    unofficialDistrict: 0,
    mismatches: { province: [], district: [], neighbourhood: [] },
  };
}

function keep(list: Mismatch[], row: AddressForCheck, tag: string, assigned: string): void {
  if (list.length < EXAMPLES) list.push({ id: row.id, tag, assigned, lon: row.lon, lat: row.lat });
}

export function addToCheck(result: AssignmentCheck, row: AddressForCheck, names: Names): void {
  result.hoodSources[row.hoodSource] = (result.hoodSources[row.hoodSource] ?? 0) + 1;

  const provinceTags = [row.tags.province, row.tags.city].filter((t): t is string => !!t);
  const provinceTag = provinceTags.find((t) => findProvince(t) !== null);
  if (provinceTag === undefined) result.skipped.province += 1;
  else {
    result.province.total += 1;
    if (findProvince(provinceTag)?.plate === row.plate) result.province.agree += 1;
    else keep(result.mismatches.province, row, provinceTag, row.plate);
  }

  const assignedName = names.district(row.district);
  const assignedId = assignedName ? findDistrict(assignedName, row.plate)[0]?.id : undefined;
  const districtTags = [row.tags.district, row.tags.city].filter((t): t is string => !!t);
  const districtTag = districtTags.find((t) => findDistrict(t).length > 0);
  if (assignedId === undefined) result.unofficialDistrict += 1;
  else if (districtTag === undefined) result.skipped.district += 1;
  else {
    result.district.total += 1;
    if (findDistrict(districtTag).some((m) => m.id === assignedId)) result.district.agree += 1;
    else keep(result.mismatches.district, row, districtTag, assignedName ?? '');
  }

  const hoodTag = row.tags.neighbourhood || row.tags.suburb;
  const hoodAssigned = row.neighbourhood ? names.hood(row.neighbourhood) : row.hoodName;
  if (hoodTag && hoodAssigned && (row.hoodSource === 'polygon' || row.hoodSource === 'place')) {
    result.neighbourhood.total += 1;
    if (nameKey(cleanNeighbourhoodName(hoodTag)) === nameKey(cleanNeighbourhoodName(hoodAssigned))) result.neighbourhood.agree += 1;
    else keep(result.mismatches.neighbourhood, row, hoodTag, hoodAssigned);
  }
}

export function checkAssignment(rows: AddressForCheck[], names: Names): AssignmentCheck {
  const result = emptyCheck();
  for (const row of rows) addToCheck(result, row, names);
  return result;
}
