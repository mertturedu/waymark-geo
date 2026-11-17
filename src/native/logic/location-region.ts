import { distanceM } from '../../core/geo/distance';

export type Point = [number, number];

export const MIN_MOVE_M = 1500;
export const REREAD_MS = 600_000;
export const RETRY_FIX_MS = 30_000;

export const movedEnough = (last: Point | null, next: Point, minMoveM: number = MIN_MOVE_M): boolean => last === null || distanceM(last, next) >= minMoveM;

export const nextReadMs = (gotFix: boolean): number => (gotFix ? REREAD_MS : RETRY_FIX_MS);

const MS_FROM = 1e11;

export const timestampMs = (timestamp: number): number => (Number.isFinite(timestamp) ? (timestamp < MS_FROM ? timestamp * 1000 : timestamp) : 0);

export const ageMs = (timestamp: number, now: number = Date.now()): number => now - timestampMs(timestamp);
