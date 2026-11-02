export const ROAD_CLASSES = [
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'ferry',
] as const;

export type RoadClass = (typeof ROAD_CLASSES)[number];

const FREE_FLOW_KMH: Record<RoadClass, number> = {
  motorway: 100,
  motorway_link: 50,
  trunk: 80,
  trunk_link: 45,
  primary: 60,
  primary_link: 40,
  secondary: 50,
  secondary_link: 35,
  tertiary: 45,
  tertiary_link: 30,
  unclassified: 40,
  residential: 30,
  living_street: 15,
  service: 20,
  ferry: 20,
};

const NAMED_LIMITS: Record<string, number> = { 'TR:urban': 50, 'TR:rural': 90, 'TR:motorway': 120, walk: 7 };
const STREET_CLASSES: ReadonlyArray<RoadClass> = ['residential', 'service', 'unclassified'];
const STREET_FACTOR = 0.65;
export const MOTORCYCLE_FACTOR = 0.85;
const POSTED_FACTOR = 0.9;
const MIN_KMH = 5;
const MAX_LIMIT_KMH = 140;
const MPH = 1.609344;
const BOARDING_DS = 3000;
const JUNCTION_DS: Record<RoadClass, number> = {
  motorway: 10, motorway_link: 25, trunk: 5, trunk_link: 25, primary: 10, primary_link: 25, secondary: 5, secondary_link: 25,
  tertiary: 7, tertiary_link: 25, unclassified: 4, residential: 4, living_street: 4, service: 25, ferry: 0,
};

export function parseMaxspeed(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  if (Object.prototype.hasOwnProperty.call(NAMED_LIMITS, text)) return NAMED_LIMITS[text] as number;
  const match = /^(\d{1,3})(?:\s?(mph|km\/h|kmh))?$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]) * (match[2] === 'mph' ? MPH : 1);
  return value >= MIN_KMH && value <= MAX_LIMIT_KMH ? value : null;
}

export function speedKmh(cls: RoadClass, maxspeed: string | null): number {
  const posted = parseMaxspeed(maxspeed);
  const base = posted === null ? FREE_FLOW_KMH[cls] : posted * POSTED_FACTOR;
  return Math.max(MIN_KMH, STREET_CLASSES.includes(cls) ? base * STREET_FACTOR : base);
}

export type RoadContext = { near: number; wide: number; lengthM: number };

type Group = 'mw' | 'mwl' | 'tr' | 'pr' | 'se' | 'te' | 'lnk' | 'st' | 'sv';

const GROUP: Record<Exclude<RoadClass, 'ferry'>, Group> = {
  motorway: 'mw', motorway_link: 'mwl', trunk: 'tr', trunk_link: 'lnk', primary: 'pr', primary_link: 'lnk', secondary: 'se', secondary_link: 'lnk',
  tertiary: 'te', tertiary_link: 'lnk', unclassified: 'st', residential: 'st', living_street: 'st', service: 'sv',
};

const CLASS_LOG: Record<Exclude<RoadClass, 'ferry'>, number> = {
  motorway: 4.38, motorway_link: 4.02, trunk: 4.03, trunk_link: 3.66, primary: 3.8, primary_link: 3.46, secondary: 3.61, secondary_link: 3.55,
  tertiary: 3.47, tertiary_link: 3.32, unclassified: 3.06, residential: 3.02, living_street: 2.92, service: 2.6,
};

const NEAR_EDGES = [2, 5, 10, 20, 40, 80];
const WIDE_EDGES = [100, 400, 1000, 2500, 6000];
const LENGTH_EDGES = [40, 80, 150, 300, 600, 1200];

const POSTED_LOG: Record<Group, number[]> = {
  mw: [-0.07, 0, 0, -0.04, 0.08],
  mwl: [-0.03, -0.06, -0.05, 0.04, 0.1],
  tr: [0, -0.06, -0.06, -0.02, 0.14],
  pr: [0.01, -0.14, -0.12, 0.16, 0.05],
  se: [0.04, -0.1, -0.03, 0.09, 0],
  te: [0.02, -0.04, 0.01, 0, 0],
  lnk: [-0.02, -0.08, -0.03, 0.13, 0],
  st: [-0.03, -0.01, 0.04, 0, 0],
  sv: [0, 0, 0, 0, 0],
};

const NEAR_LOG: Record<Group, number[]> = {
  mw: [0.13, 0.14, -0.12, 0.07, 0.02, -0.06, -0.22],
  mwl: [0, 0.02, 0.06, 0.1, 0.02, -0.09, -0.11],
  tr: [0.02, 0.06, -0.02, 0.12, 0.1, 0.03, -0.12],
  pr: [0.04, 0.13, 0.16, 0.08, 0.13, -0.01, -0.32],
  se: [0, -0.01, 0.03, 0.06, 0.08, 0.03, -0.18],
  te: [0, 0.03, 0, 0.03, 0.01, -0.01, -0.08],
  lnk: [0, 0.01, 0, -0.01, 0.02, 0.04, -0.05],
  st: [0, 0, 0.02, 0, 0.01, -0.02, 0],
  sv: [0, 0, 0, 0, -0.01, 0, 0.01],
};

const WIDE_LOG: Record<Group, number[]> = {
  mw: [0.05, 0.11, -0.19, 0.07, -0.06, -0.01],
  mwl: [0, -0.01, 0.07, 0.02, -0.06, -0.03],
  tr: [0.21, 0.12, 0.02, 0.06, -0.01, -0.14],
  pr: [0.13, 0.03, 0.04, 0.04, 0, 0.13],
  se: [0, 0.04, 0.06, -0.01, -0.05, 0.03],
  te: [0.02, -0.03, 0.03, 0.07, -0.02, -0.06],
  lnk: [0, 0.01, -0.04, -0.02, -0.06, 0.12],
  st: [0, 0.01, 0.02, 0.03, -0.03, -0.01],
  sv: [-0.01, 0, -0.01, 0.02, 0, 0],
};

const LENGTH_LOG: Record<Group, number[]> = {
  mw: [-0.01, 0.01, 0, 0.02, -0.06, -0.01, 0.04],
  mwl: [-0.02, 0, 0.02, -0.05, -0.04, 0.1, -0.01],
  tr: [-0.06, -0.03, -0.01, 0.01, 0.07, 0.13, 0.03],
  pr: [-0.14, -0.1, -0.02, 0.05, 0.16, 0.2, 0.24],
  se: [-0.09, -0.1, -0.04, 0.05, 0.08, 0.08, 0.13],
  te: [-0.09, -0.09, -0.05, 0, 0.11, 0.1, 0.04],
  lnk: [-0.1, -0.08, -0.02, 0.03, 0.07, 0.12, 0],
  st: [-0.01, -0.02, 0.01, 0.03, -0.01, 0.01, 0],
  sv: [0, 0, 0.01, 0.01, 0, -0.01, 0],
};

export const bucketOf = (value: number, edges: ReadonlyArray<number>): number => {
  let i = 0;
  while (i < edges.length && value >= (edges[i] as number)) i++;
  return i;
};

const postedBand = (posted: number | null): number => (posted === null ? 0 : posted <= 40 ? 1 : posted <= 60 ? 2 : posted <= 90 ? 3 : 4);

export function roadKmh(cls: RoadClass, maxspeed: string | null, road: RoadContext): number {
  if (cls === 'ferry') return FREE_FLOW_KMH.ferry;
  const g = GROUP[cls];
  const log = CLASS_LOG[cls] + (POSTED_LOG[g][postedBand(parseMaxspeed(maxspeed))] as number) + (NEAR_LOG[g][bucketOf(road.near, NEAR_EDGES)] as number) + (WIDE_LOG[g][bucketOf(road.wide, WIDE_EDGES)] as number) + (LENGTH_LOG[g][bucketOf(road.lengthM, LENGTH_EDGES)] as number);
  return Math.min(MAX_LIMIT_KMH, Math.max(MIN_KMH, Math.exp(log)));
}

export function travelDeciseconds(lengthM: number, kmh: number): number {
  return Math.max(1, Math.round((lengthM / (kmh / 3.6)) * 10));
}

export function ferryDeciseconds(lengthM: number, durationS: number | null, boarding: boolean): number {
  const water = durationS === null ? travelDeciseconds(lengthM, FREE_FLOW_KMH.ferry) : Math.round(durationS * 10);
  return water + (boarding ? BOARDING_DS : 0);
}

export function junctionPenalty(cls: RoadClass): number {
  return JUNCTION_DS[cls];
}

export function speedTable(): { class: Record<RoadClass, number>; named: Record<string, number>; posted: number; min: number; max: number; mph: number; streets: { classes: RoadClass[]; factor: number } } {
  return { class: { ...FREE_FLOW_KMH }, named: { ...NAMED_LIMITS }, posted: POSTED_FACTOR, min: MIN_KMH, max: MAX_LIMIT_KMH, mph: MPH, streets: { classes: [...STREET_CLASSES], factor: STREET_FACTOR } };
}
