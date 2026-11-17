import aliases from './data/admin-aliases.json';
import data from './data/admin.json';
import { nameKey } from './fold';
import type { AdminData, AdminDistrict, AdminMatch, AdminNames, AdminProvince } from './types';

const keysOf = (names: AdminNames, alt: string[]): string[] => {
  const keys = new Set<string>();
  for (const value of [...Object.values(names), ...alt]) {
    const key = nameKey(value);
    if (key !== '') keys.add(key);
  }
  return [...keys];
};

const districtId = (district: AdminDistrict): string => `${district.province}/${nameKey(district.names.tr)}`;

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function createAdmin(source: AdminData, extra: { province: unknown; district: unknown } = { province: {}, district: {} }) {
  const provinceByKey = new Map<string, AdminProvince[]>();
  const districtByKey = new Map<string, AdminDistrict[]>();
  const names = new Map<string, string>();
  const provinceNamesOf = new Map<string, AdminNames>();
  const districtNamesOf = new Map<string, AdminNames>();
  const provinceAliases = extra.province as Record<string, string[]>;
  const districtAliases = extra.district as Record<string, Record<string, string[]>>;
  for (const province of source.provinces) {
    names.set(province.plate, province.names.tr);
    provinceNamesOf.set(province.plate, province.names);
    for (const key of new Set([...keysOf(province.names, province.alt), ...(provinceAliases[province.plate] ?? [])])) push(provinceByKey, key, province);
  }
  for (const district of source.districts) {
    districtNamesOf.set(districtId(district), district.names);
    const own = districtAliases[district.province]?.[nameKey(district.names.tr)] ?? [];
    for (const key of new Set([...keysOf(district.names, district.alt), ...own])) push(districtByKey, key, district);
  }

  const provinceMatch = (province: AdminProvince, ambiguous: boolean): AdminMatch => ({ id: province.plate, name: province.names.tr, plate: province.plate, ambiguous });
  const districtMatch = (district: AdminDistrict, ambiguous: boolean): AdminMatch => ({ id: districtId(district), name: district.names.tr, plate: district.province, ambiguous });

  return {
    findProvince(text: string): AdminMatch | null {
      const hits = provinceByKey.get(nameKey(text));
      return hits ? provinceMatch(hits[0] as AdminProvince, hits.length > 1) : null;
    },
    findDistrict(text: string, plate?: string): AdminMatch[] {
      const hits = (districtByKey.get(nameKey(text)) ?? []).filter((district) => plate === undefined || district.province === plate);
      return hits.map((district) => districtMatch(district, hits.length > 1));
    },
    provinceByPlate: (plate: string): AdminMatch | null => {
      const province = source.provinces.find((candidate) => candidate.plate === plate);
      return province ? provinceMatch(province, false) : null;
    },
    isProvinceName: (text: string): boolean => provinceByKey.has(nameKey(text)),
    isDistrictName: (text: string): boolean => districtByKey.has(nameKey(text)),
    provinceIds: (): string[] => source.provinces.map((province) => province.plate),
    districtCount: (): number => source.districts.length,
    provinceName: (plate: string): string | null => names.get(plate) ?? null,
    provinceNames: (plate: string): AdminNames | null => provinceNamesOf.get(plate) ?? null,
    districtNames: (id: string): AdminNames | null => districtNamesOf.get(id) ?? null,
  };
}

let instance: ReturnType<typeof createAdmin> | null = null;
const admin = () => (instance ??= createAdmin(data as AdminData, aliases));

export const findProvince = (text: string): AdminMatch | null => admin().findProvince(text);
export const findDistrict = (text: string, plate?: string): AdminMatch[] => admin().findDistrict(text, plate);
export const provinceByPlate = (plate: string): AdminMatch | null => admin().provinceByPlate(plate);
export const isProvinceName = (text: string): boolean => admin().isProvinceName(text);
export const isDistrictName = (text: string): boolean => admin().isDistrictName(text);
export const provinceIds = (): string[] => admin().provinceIds();
export const districtCount = (): number => admin().districtCount();
export const provinceName = (plate: string): string | null => admin().provinceName(plate);
export const provinceNames = (plate: string): AdminNames | null => admin().provinceNames(plate);
export const districtNames = (id: string): AdminNames | null => admin().districtNames(id);
