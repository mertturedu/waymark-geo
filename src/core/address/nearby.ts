export const NEARBY_GROUPS = {
  health: ['hospital', 'clinic', 'doctors', 'dentist', 'medical', 'medical_supply'],
  pharmacy: ['pharmacy'],
  safety: ['police', 'fire_station', 'courthouse', 'prison'],
  money: ['bank', 'atm', 'money_transfer', 'bureau_de_change'],
  fuel: ['fuel', 'car_wash', 'car_repair'],
  worship: ['place_of_worship', 'religious'],
  lodging: ['hotel', 'motel', 'hostel', 'guest_house'],
  market: ['marketplace', 'mall', 'department_store'],
  public: ['public_building', 'kindergarten', 'college', 'bus_station', 'community_centre', 'cemetery', 'public_bath', 'turkish_bath'],
} as const satisfies Record<string, readonly string[]>;

export type NearbyGroup = keyof typeof NEARBY_GROUPS;

export const NEARBY_DEFAULT_RADIUS_M = 3000;
export const NEARBY_MAX_RADIUS_M = 20000;
export const NEARBY_DEFAULT_LIMIT = 10;
export const NEARBY_MAX_LIMIT = 50;
export const NEARBY_READ_CAP = 400;

export const isNearbyGroup = (value: unknown): value is NearbyGroup => typeof value === 'string' && Object.prototype.hasOwnProperty.call(NEARBY_GROUPS, value);

export function boxAround(point: readonly [number, number], radiusM: number): [number, number, number, number] {
  const dLat = radiusM / 110540;
  const dLng = radiusM / (111320 * Math.max(0.01, Math.cos((point[1] * Math.PI) / 180)));
  return [point[0] - dLng, point[1] - dLat, point[0] + dLng, point[1] + dLat];
}

export function clampRadius(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : NEARBY_DEFAULT_RADIUS_M;
  return Math.min(NEARBY_MAX_RADIUS_M, Math.max(50, n));
}

export function clampLimit(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : NEARBY_DEFAULT_LIMIT;
  return Math.min(NEARBY_MAX_LIMIT, Math.max(1, n));
}
