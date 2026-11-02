import type { LngLat } from '../geo/cells';
import { lineLengthM, pointAlong, projectOnLine, distanceM } from '../geo/distance';
import type { BuildingSnap } from './buildings';
import type { AddressRow, PartRow, Region } from './pack';
import type { LayerNeighbour, Precision } from './types';

export type Variant = 'A' | 'B' | 'C';
export type Prediction = {
  coordinate: LngLat;
  precision: Extract<Precision, 'interpolated' | 'street' | 'neighbourhood' | 'district'>;
  confidence: number;
  snapped?: boolean;
  variant: Variant | 'one-sided' | 'street' | 'hood' | 'district';
};

type Street = { id: number; hoodId: number | null; districtId: number | null };
type Wanted = { int: number; key: string; parity: 0 | 1 };
type Options = { exclude?: ReadonlySet<number>; variant?: Variant; parts?: PartRow[]; snap?: BuildingSnap; extra?: LayerNeighbour[] };

const DEFAULT_VARIANT: Variant = 'B';
export const ONE_SIDED_FLOOR = 0.15;

function learnedRow(n: LayerNeighbour, street: Street, index: number): AddressRow {
  return { id: -(index + 1), streetId: street.id, districtId: street.districtId as number, hoodId: street.hoodId, place: null, number: String(n.int), nkey: String(n.int), num: n.int, suffix: '', parity: n.int % 2, lng: n.coordinate[0], lat: n.coordinate[1], osm: 0, postcode: null };
}

function chooseNeighbours(rows: AddressRow[], street: Street, target: number): { lower: AddressRow | null; upper: AddressRow | null } {
  const near = (list: AddressRow[]): { lower: AddressRow | null; upper: AddressRow | null } => {
    let lower: AddressRow | null = null;
    let upper: AddressRow | null = null;
    for (const r of list) {
      const num = r.num as number;
      if (num < target && (lower === null || num > (lower.num as number))) lower = r;
      if (num > target && (upper === null || num < (upper.num as number))) upper = r;
    }
    return { lower, upper };
  };
  const local = near(rows.filter((r) => r.hoodId === street.hoodId && r.districtId === street.districtId));
  if (local.lower && local.upper) return local;
  return near(rows.filter((r) => r.districtId === street.districtId));
}

function bestLine(lines: LngLat[][], a: LngLat, b: LngLat): LngLat[] | null {
  let best: LngLat[] | null = null;
  let cost = Infinity;
  for (const line of lines) {
    if (line.length < 2) continue;
    const value = projectOnLine(a, line).distanceM + projectOnLine(b, line).distanceM;
    if (value < cost) {
      cost = value;
      best = line;
    }
  }
  return best;
}

function between(variant: Variant, lower: AddressRow, upper: AddressRow, t: number, lines: LngLat[][]): { point: LngLat; variant: Variant } {
  const a: LngLat = [lower.lng, lower.lat];
  const b: LngLat = [upper.lng, upper.lat];
  const straight: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  if (variant === 'C') return { point: straight, variant: 'C' };
  const line = bestLine(lines, a, b);
  if (!line) return { point: straight, variant };
  const pa = projectOnLine(a, line);
  const pb = projectOnLine(b, line);
  const onLine = pointAlong(line, pa.alongM + t * (pb.alongM - pa.alongM));
  if (variant === 'A') return { point: onLine, variant: 'A' };
  const offset: LngLat = [(a[0] - pa.point[0]) * (1 - t) + (b[0] - pb.point[0]) * t, (a[1] - pa.point[1]) * (1 - t) + (b[1] - pb.point[1]) * t];
  return { point: [onLine[0] + offset[0], onLine[1] + offset[1]], variant: 'B' };
}

export function streetMiddle(parts: PartRow[], districtId: number, hoodId: number | null): LngLat | null {
  const here = parts.filter((p) => p.districtId === districtId && p.hoodId === hoodId).flatMap((p) => p.lines);
  const lines = here.length > 0 ? here : parts.filter((p) => p.districtId === districtId).flatMap((p) => p.lines);
  if (lines.length === 0) return null;
  const longest = lines.reduce((x, y) => (lineLengthM(y) > lineLengthM(x) ? y : x));
  return pointAlong(longest, lineLengthM(longest) / 2);
}

export async function predictNumber(region: Region, street: Street, number: Wanted, options: Options = {}): Promise<Prediction | null> {
  const variant = options.variant ?? DEFAULT_VARIANT;
  const exclude = options.exclude;
  const learned = (options.extra ?? []).filter((n) => n.int % 2 === number.parity).map((n, i) => learnedRow(n, street, i));
  const rows = [...(await region.neighbours(street.id, number.parity, street.districtId)).filter((r) => r.num !== null && !(exclude && exclude.has(r.id))), ...learned];
  const parts = options.parts ?? (await region.partsOf(street.id));
  const { lower, upper } = chooseNeighbours(rows, street, number.int);
  if (lower && upper) {
    const lines = parts.flatMap((p) => p.lines);
    const t = (number.int - (lower.num as number)) / ((upper.num as number) - (lower.num as number));
    const result = between(variant, lower, upper, t, lines);
    const gap = distanceM([lower.lng, lower.lat], [upper.lng, upper.lat]);
    const building = options.snap ? await options.snap(result.point, exclude) : null;
    return { coordinate: building ?? result.point, snapped: building !== null, precision: 'interpolated', confidence: Math.round((0.85 - Math.min(0.4, gap / 2500)) * 1000) / 1000, variant: result.variant };
  }
  const single = lower ?? upper;
  if (single) {
    const gap = Math.abs((single.num as number) - number.int);
    return { coordinate: [single.lng, single.lat], precision: 'interpolated', confidence: Math.round(Math.max(ONE_SIDED_FLOOR, 0.45 - gap * 0.02) * 1000) / 1000, variant: 'one-sided' };
  }
  if (street.districtId === null) return null;
  const middle = streetMiddle(parts, street.districtId, street.hoodId);
  if (middle) return { coordinate: middle, precision: 'street', confidence: 0.4, variant: 'street' };
  const hood = street.hoodId === null ? null : (region.hoods.find((h) => h.id === street.hoodId) ?? null);
  if (hood?.center) return { coordinate: hood.center, precision: 'neighbourhood', confidence: 0.3, variant: 'hood' };
  const district = region.districts.find((d) => d.id === street.districtId);
  return district ? { coordinate: district.center, precision: 'district', confidence: 0.2, variant: 'district' } : null;
}
