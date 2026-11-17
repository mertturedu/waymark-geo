import type { LngLat } from '../geo/cells';
import { distanceM } from '../geo/distance';
import { nameKey } from '../text/fold';
import type { Lang } from '../text/types';
import { floorFromLayout } from '../learned/layout';
import type { BuildingLayout } from '../learned/types';
import type { BuildingInfo, EntranceInfo } from './buildings2';
import { estimateFloor, type FloorInfo } from './floor';

export { estimateFloor };
export type { FloorInfo, FloorSource } from './floor';

export type UnitInput = { floor: string | null; door: string | null; block: string | null; entrance?: string | null };


export type UnitInfo = {
  block: { name: string; building: number | null; center: LngLat | null } | null;
  entrance: EntranceInfo | null;
  floor: FloorInfo | null;
  door: string | null;
  levels: number | null;
  perFloor: number | null;
  notes: string[];
};

export type UnitOptions = { basement?: number; flatM2?: number; layout?: BuildingLayout | null };

export const FLAT_M2 = 120;
export const MAX_PER_FLOOR = 8;
export const SITE_RADIUS_M = 150;
const DOOR_SLACK = 1.5;
const MODEL_TOLERANCE = 1;
const REGION_LEVELS_SLACK = 3;

const FLOOR_WORDS: Record<string, number> = { zemin: 0, giris: 0, bodrum: -1, 'yari bodrum': -1, cati: Number.NaN };

export const isRoofFloor = (text: string | null): boolean => text !== null && /^cati( kati)?$/.test(nameKey(text));

export function floorNumber(text: string | null): number | null {
  if (text === null) return null;
  const key = nameKey(text);
  if (key in FLOOR_WORDS) {
    const value = FLOOR_WORDS[key] as number;
    return Number.isNaN(value) ? null : value;
  }
  const sign = /^[-−]/.test(text.trim()) ? -1 : 1;
  const digits = /\d+/.exec(text);
  return digits ? sign * Number(digits[0]) : null;
}

export function doorNumber(text: string | null): number | null {
  if (text === null) return null;
  const digits = /\d+/.exec(text);
  return digits ? Number(digits[0]) : null;
}

export function unitsPerFloor(areaM2: number, flatM2 = FLAT_M2): number {
  return Math.max(1, Math.min(MAX_PER_FLOOR, Math.round(areaM2 / flatM2)));
}

export const blockKey = (text: string): string => nameKey(text).replace(/\b(blok|block|blk|bl)\b/g, ' ').replace(/\s+/g, ' ').trim();

const endsWithBlock = (name: string, wanted: string): boolean => name === wanted || name.endsWith(` ${wanted}`);

export function resolveBlock(block: string, base: BuildingInfo, around: BuildingInfo[]): BuildingInfo | null {
  const wanted = blockKey(block);
  if (wanted === '') return null;
  const matches = [base, ...around].filter((b) => b.name !== null && /blok|block/i.test(b.name) && endsWithBlock(blockKey(b.name), wanted) && distanceM(b.center, base.center) <= SITE_RADIUS_M);
  if (matches.length === 0) return null;
  return matches.sort((a, b) => distanceM(a.center, base.center) - distanceM(b.center, base.center) || a.id - b.id)[0] as BuildingInfo;
}

function flatsRange(text: string | null): [number, number] | null {
  if (!text) return null;
  const m = /(\d+)\s*[-–]\s*(\d+)/.exec(text);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function pickEntrance(entrances: EntranceInfo[], door: number | null, ref: string | null = null): EntranceInfo | null {
  if (entrances.length === 0) return null;
  if (ref !== null) {
    const wanted = nameKey(ref);
    const named = entrances.filter((e) => e.ref !== null && nameKey(e.ref) === wanted);
    if (named.length === 1) return named[0] as EntranceInfo;
  }
  if (entrances.length === 1) return entrances[0] as EntranceInfo;
  if (door !== null) {
    const hits = entrances.filter((e) => {
      const range = flatsRange(e.flats);
      return range !== null && door >= range[0] && door <= range[1];
    });
    if (hits.length === 1) return hits[0] as EntranceInfo;
  }
  return null;
}

export function resolveUnit(input: UnitInput, base: BuildingInfo, around: BuildingInfo[], entrances: (building: number) => EntranceInfo[], options: UnitOptions = {}): UnitInfo {
  const notes: string[] = [];
  let building = base;
  let block: UnitInfo['block'] = null;
  if (input.block !== null) {
    const found = resolveBlock(input.block, base, around);
    if (found) {
      building = found;
      block = { name: input.block, building: found.id, center: found.center };
    } else {
      block = { name: input.block, building: null, center: null };
      notes.push('block_not_found');
    }
  }
  const door = doorNumber(input.door);
  const written = floorNumber(input.floor);
  const levels = building.levels;
  const perFloor = unitsPerFloor(building.areaM2, options.flatM2);
  const regional = building.levelsSource === 'region';
  let floor: FloorInfo | null = null;
  if (isRoofFloor(input.floor)) floor = { value: Math.max(0, levels - 1), low: Math.max(0, levels - 2), high: levels, source: 'model' };
  else if (written !== null) floor = { value: written, low: written, high: written, source: 'written' };
  else if (door !== null) floor = (options.layout ? floorFromLayout(options.layout, door) : null) ?? estimateFloor(door, perFloor, options.basement ?? 0);
  if (written !== null && written > levels + 1 + (regional ? REGION_LEVELS_SLACK : 0)) notes.push('floor_out_of_range');
  if (door !== null && door > levels * perFloor * DOOR_SLACK + (regional ? REGION_LEVELS_SLACK * perFloor : 0)) notes.push('door_out_of_range');
  if (written !== null && door !== null) {
    const model = estimateFloor(door, perFloor, options.basement ?? 0);
    if (written < model.low - MODEL_TOLERANCE || written > model.high + MODEL_TOLERANCE) notes.push('floor_door_mismatch');
  }
  return { block, entrance: pickEntrance(entrances(building.id), door, input.entrance ?? null), floor, door: input.door, levels: levels, perFloor, notes };
}

type Words = { block: string; floor: string; floorWord: (n: number) => string; door: string; estimated: string; entrance: string };

const WORDS: Record<Lang, Words> = {
  tr: { block: '{} Blok', floor: 'Kat {}', floorWord: (n) => (n === 0 ? 'Zemin Kat' : n < -1 ? `${-n}. Bodrum Kat` : n < 0 ? 'Bodrum Kat' : `Kat ${n}`), door: 'Daire {}', estimated: 'tahmini', entrance: 'Giriş {}' },
  en: { block: 'Block {}', floor: 'Floor {}', floorWord: (n) => (n === 0 ? 'Ground floor' : n < -1 ? `Basement ${-n}` : n < 0 ? 'Basement' : `Floor ${n}`), door: 'Apt {}', estimated: 'est.', entrance: 'Entrance {}' },
  de: { block: 'Block {}', floor: '{}. Stock', floorWord: (n) => (n === 0 ? 'Erdgeschoss' : n < -1 ? `${-n}. Untergeschoss` : n < 0 ? 'Untergeschoss' : `${n}. Stock`), door: 'Wohnung {}', estimated: 'geschätzt', entrance: 'Eingang {}' },
  ar: { block: 'المبنى {}', floor: 'الطابق {}', floorWord: (n) => (n === 0 ? 'الطابق الأرضي' : n < -1 ? `القبو ${-n}` : n < 0 ? 'القبو' : `الطابق ${n}`), door: 'الشقة {}', estimated: 'تقديري', entrance: 'المدخل {}' },
  ru: { block: 'Корпус {}', floor: 'этаж {}', floorWord: (n) => (n === 0 ? 'первый этаж' : n < -1 ? `подвал ${-n}` : n < 0 ? 'подвал' : `этаж ${n}`), door: 'кв. {}', estimated: 'примерно', entrance: 'подъезд {}' },
  el: { block: 'Κτίριο {}', floor: 'όροφος {}', floorWord: (n) => (n === 0 ? 'ισόγειο' : n < -1 ? `υπόγειο ${-n}` : n < 0 ? 'υπόγειο' : `όροφος ${n}`), door: 'διαμ. {}', estimated: 'εκτίμηση', entrance: 'είσοδος {}' },
};

const fill = (pattern: string, value: string): string => pattern.replace('{}', value);
const trimBlock = (name: string): string => name.replace(/\s*(blok|block)\s*/gi, ' ').trim();

export const entranceWord = (ref: string, lang: Lang = 'tr'): string => fill(WORDS[lang].entrance, ref);

export function formatEntrance(unit: UnitInfo, lang: Lang = 'tr'): string {
  const w = WORDS[lang];
  const parts: string[] = [];
  if (unit.block) parts.push(fill(w.block, trimBlock(unit.block.name)));
  if (unit.entrance?.ref) parts.push(fill(w.entrance, unit.entrance.ref));
  return parts.join(lang === 'ar' ? '، ' : ', ');
}

export function formatUnit(unit: UnitInfo, lang: Lang = 'tr'): string {
  const w = WORDS[lang];
  const parts: string[] = [];
  if (unit.block) parts.push(fill(w.block, trimBlock(unit.block.name)));
  if (unit.entrance?.ref) parts.push(fill(w.entrance, unit.entrance.ref));
  if (unit.floor) {
    const base = w.floorWord(unit.floor.value);
    parts.push(unit.floor.source === 'model' || (unit.floor.source === 'learned' && unit.floor.low !== unit.floor.high) ? `${base} (${w.estimated}${unit.floor.low !== unit.floor.high ? `: ${unit.floor.low}-${unit.floor.high}` : ''})` : base);
  }
  if (unit.door) parts.push(fill(w.door, unit.door));
  return parts.join(lang === 'ar' ? '، ' : ', ');
}
