import { ROAD_CLASSES, type RoadClass } from '../route/speeds';

export type DayKind = 'weekday' | 'saturday' | 'sunday';

export type MapRoadKind = 'highway' | 'major_road' | 'medium_road' | 'minor_road';

const TURKEY_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;
const MAX_SLOWDOWN = 0.75;

const PROFILE: Record<DayKind, number[]> = {
  weekday: [0.1, 0.04, 0.03, 0.03, 0.02, 0.1, 0.32, 0.66, 0.82, 0.71, 0.62, 0.61, 0.62, 0.61, 0.68, 0.74, 0.8, 0.91, 1, 0.82, 0.51, 0.33, 0.26, 0.18, 0.1],
  saturday: [0.16, 0.06, 0.03, 0.02, 0.03, 0.09, 0.17, 0.23, 0.32, 0.43, 0.51, 0.57, 0.66, 0.75, 0.79, 0.8, 0.77, 0.78, 0.79, 0.69, 0.5, 0.4, 0.39, 0.33, 0.16],
  sunday: [0.22, 0.07, 0.02, 0.02, 0.02, 0.07, 0.09, 0.09, 0.1, 0.12, 0.16, 0.22, 0.34, 0.47, 0.57, 0.61, 0.61, 0.6, 0.59, 0.52, 0.4, 0.37, 0.34, 0.22, 0.22],
};

const MAP_PROFILE: Record<DayKind, number[]> = {
  weekday: [0.02, 0.01, 0.01, 0.01, 0.03, 0.08, 0.25, 0.6, 0.95, 0.85, 0.5, 0.4, 0.45, 0.5, 0.5, 0.55, 0.7, 0.95, 1, 0.85, 0.55, 0.3, 0.15, 0.06, 0.02],
  saturday: [0.04, 0.02, 0.02, 0.01, 0.01, 0.02, 0.05, 0.1, 0.18, 0.28, 0.38, 0.45, 0.5, 0.52, 0.52, 0.52, 0.52, 0.5, 0.45, 0.38, 0.3, 0.22, 0.12, 0.06, 0.04],
  sunday: [0.03, 0.02, 0.01, 0.01, 0.01, 0.01, 0.02, 0.04, 0.07, 0.12, 0.18, 0.24, 0.28, 0.3, 0.3, 0.3, 0.32, 0.35, 0.35, 0.3, 0.22, 0.14, 0.08, 0.04, 0.03],
};

const CLASS_SLOWDOWN: Record<RoadClass, number> = {
  motorway: 0.334,
  motorway_link: 0.271,
  trunk: 0.313,
  trunk_link: 0.251,
  primary: 0.271,
  primary_link: 0.23,
  secondary: 0.209,
  secondary_link: 0.188,
  tertiary: 0.125,
  tertiary_link: 0.117,
  unclassified: 0.063,
  residential: 0.042,
  living_street: 0.021,
  service: 0.033,
  ferry: 0,
};

const MAP_SLOWDOWN: Record<MapRoadKind, number> = { highway: 0.8, major_road: 0.42, medium_road: 0.3, minor_road: 0.1 };

const BUSY: Record<string, number> = { '34': 1, '06': 0.9, '35': 0.9, '16': 0.85, '07': 0.8, '01': 0.8, '42': 0.75, '27': 0.75, '41': 0.75, '33': 0.7, '31': 0.65, '38': 0.65, '55': 0.6, '25': 0.6, '21': 0.6, '26': 0.6, '20': 0.6, '45': 0.55, '10': 0.55, '59': 0.55, '54': 0.55, '48': 0.55, '09': 0.55 };
const DEFAULT_BUSY = 0.4;

export function localTime(at: number): { hour: number; day: DayKind } {
  const local = at + TURKEY_OFFSET_MS;
  const into = ((local % DAY_MS) + DAY_MS) % DAY_MS;
  const weekday = (Math.floor(local / DAY_MS) + 4) % 7;
  return { hour: into / 3_600_000, day: weekday === 6 ? 'saturday' : weekday === 0 ? 'sunday' : 'weekday' };
}

function curveAt(tables: Record<DayKind, number[]>, at: number): number {
  const { hour, day } = localTime(at);
  const table = tables[day];
  const low = Math.floor(hour);
  const share = hour - low;
  return (table[low] as number) * (1 - share) + (table[low + 1] as number) * share;
}

export const congestion = (at: number): number => curveAt(PROFILE, at);

export const regionBusyness = (plate: string): number => BUSY[plate] ?? DEFAULT_BUSY;

const bound = (value: number): number => Math.min(MAX_SLOWDOWN, Math.max(0, value));

export const slowdownOf = (cls: RoadClass, at: number, busyness: number): number => bound(congestion(at) * CLASS_SLOWDOWN[cls] * busyness);

export const slowdownOfIndex = (classIndex: number, at: number, busyness: number): number => slowdownOf(ROAD_CLASSES[classIndex] ?? 'residential', at, busyness);

const TOP_CLASS_SLOWDOWN = CLASS_SLOWDOWN.motorway;

export const observedSlowdownOf = (cls: RoadClass, observed: number): number => bound((observed * CLASS_SLOWDOWN[cls]) / TOP_CLASS_SLOWDOWN);

const MAP_CLASS: Record<MapRoadKind, RoadClass> = { highway: 'motorway', major_road: 'secondary', medium_road: 'tertiary', minor_road: 'residential' };

export const observedMapSlowdown = (kind: MapRoadKind, observed: number): number => observedSlowdownOf(MAP_CLASS[kind], observed);

export const mapSlowdown = (kind: MapRoadKind, at: number, busyness: number): number => bound(curveAt(MAP_PROFILE, at) * MAP_SLOWDOWN[kind] * busyness);

export type TrafficBand = 'smooth' | 'busy' | 'heavy' | 'jam';

export const BAND_FROM = { busy: 0.15, heavy: 0.3, jam: 0.45 } as const;

export function bandOf(slowdown: number): TrafficBand {
  if (slowdown >= BAND_FROM.jam) return 'jam';
  if (slowdown >= BAND_FROM.heavy) return 'heavy';
  if (slowdown >= BAND_FROM.busy) return 'busy';
  return 'smooth';
}

export const QUARTER_MS = 900_000;

export const trafficBucket = (at: number): number => Math.floor(at / QUARTER_MS) * QUARTER_MS;
