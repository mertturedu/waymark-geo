import type { LngLat } from '../geo/cells';

export const LEARNED_FORMAT = '1';
export const LEARNED_APPLICATION_ID = 0x59474c31;
export const LEARNED_USER_VERSION = 1;

export type FloorRange = [floor: number, low: number, high: number];
export type BuildingLayout = { perFloor: number; basement: number; floors: number; fit: number; samples: number; ranges: FloorRange[] };
export type LearnedEntrance = { point: LngLat; sources: number };
export type StreetWay = { line: LngLat[]; doors: [number, number][] };
export type StreetHint = { district: string; name: string; point: LngLat; radiusM: number; sources: number; way?: StreetWay; origin?: number };
export const ORIGIN_APPLE = 1;
export type ExtraDoor = { key: string; point: LngLat; origin: number };

export const LEARNED_SCHEMA = [
  'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID',
  'CREATE TABLE door (key TEXT PRIMARY KEY, lng INTEGER NOT NULL, lat INTEGER NOT NULL, trusted INTEGER NOT NULL, sources INTEGER NOT NULL, spread INTEGER NOT NULL, origin INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID',
  'CREATE TABLE layout (key TEXT PRIMARY KEY, per INTEGER NOT NULL, basement INTEGER NOT NULL, floors INTEGER NOT NULL, fit INTEGER NOT NULL, samples INTEGER NOT NULL, ranges TEXT NOT NULL) WITHOUT ROWID',
  'CREATE TABLE entrance (key TEXT NOT NULL, idx INTEGER NOT NULL, lng INTEGER NOT NULL, lat INTEGER NOT NULL, sources INTEGER NOT NULL, PRIMARY KEY (key, idx)) WITHOUT ROWID',
  'CREATE TABLE hint (district TEXT NOT NULL, name TEXT NOT NULL, lng INTEGER NOT NULL, lat INTEGER NOT NULL, radius INTEGER NOT NULL, sources INTEGER NOT NULL, origin INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (district, name)) WITHOUT ROWID',
  'CREATE TABLE way (district TEXT NOT NULL, name TEXT NOT NULL, line TEXT NOT NULL, doors TEXT NOT NULL, PRIMARY KEY (district, name)) WITHOUT ROWID',
];
