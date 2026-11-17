export type FloorSource = 'written' | 'learned' | 'model';
export type FloorInfo = { value: number; low: number; high: number; source: FloorSource };

export function estimateFloor(door: number, perFloor: number, basement = 0): FloorInfo {
  const at = (per: number): number => Math.ceil(door / per) - 1 - basement;
  const value = at(perFloor);
  const a = at(perFloor + 1);
  const b = at(Math.max(1, perFloor - 1));
  return { value, low: Math.min(a, value, b), high: Math.max(a, value, b), source: 'model' };
}
