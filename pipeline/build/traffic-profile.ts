import { encodeSlowdowns, type ObservedProfile } from '../../src/core/traffic/observed';

export const SLOTS = 72;
export const HOURS = 24;

export type ProfileOptions = { precision: number; levels: number; minRows: number; minFreeKmh: number; minVehicles: number; minSlotRows: number; nightHours: [number, number]; minNightRows: number; freeFlowQuantile: number };

export const PROFILE_OPTIONS: ProfileOptions = { precision: 6, levels: 35, minRows: 300, minFreeKmh: 15, minVehicles: 5, minSlotRows: 3, nightHours: [1, 4], minNightRows: 20, freeFlowQuantile: 0.9 };

export type SpeedRow = { month: string; cell: string; slot: number; speed: number; vehicles: number };

export type CellTable = { free: number; vehicles: number; slowdowns: (number | null)[] };

export function parseSpeedRow(raw: string): SpeedRow | null {
  const cols = raw.replace(/^\u{FEFF}/u, '').replace(/"/g, '').split(',');
  const [time, , , cell, , , avg, vehicles] = cols;
  if (!time || !cell || avg === undefined || vehicles === undefined) return null;
  const date = new Date(`${time.replace(' ', 'T')}Z`);
  const speed = Number(avg);
  const count = Number(vehicles);
  if (Number.isNaN(date.getTime()) || !Number.isFinite(speed) || !Number.isFinite(count)) return null;
  const weekday = date.getUTCDay();
  const day = weekday === 0 ? 2 : weekday === 6 ? 1 : 0;
  return { month: time.slice(0, 7), cell, slot: day * HOURS + date.getUTCHours(), speed, vehicles: count };
}

export const median = (list: ReadonlyArray<number>): number => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
};

export type ProfileBuilder = { add(row: SpeedRow): void; tables(): Map<string, CellTable>; profile(): ObservedProfile };

export function createProfileBuilder(options: ProfileOptions = PROFILE_OPTIONS): ProfileBuilder {
  const slots = new Map<string, number[][]>();
  const vehicles = new Map<string, number>();
  const tables = (): Map<string, CellTable> => {
    const out = new Map<string, CellTable>();
    for (const [cell, table] of slots) {
      const all = table.flat().sort((a, b) => a - b);
      if (all.length < options.minRows) continue;
      const night = table.filter((_, slot) => slot % HOURS >= options.nightHours[0] && slot % HOURS <= options.nightHours[1]).flat();
      const free = night.length >= options.minNightRows ? median(night) : (all[Math.floor(all.length * options.freeFlowQuantile)] as number);
      if (free < options.minFreeKmh) continue;
      out.set(cell, { free, vehicles: (vehicles.get(cell) ?? 0) / all.length, slowdowns: table.map((s) => (s.length >= options.minSlotRows ? Math.max(0, 1 - median(s) / free) : null)) });
    }
    return out;
  };
  return {
    add(row) {
      if (row.vehicles < options.minVehicles) return;
      const table = slots.get(row.cell) ?? Array.from({ length: SLOTS }, () => [] as number[]);
      (table[row.slot] as number[]).push(row.speed);
      slots.set(row.cell, table);
      vehicles.set(row.cell, (vehicles.get(row.cell) ?? 0) + row.vehicles);
    },
    tables,
    profile() {
      const cells: Record<string, string> = {};
      for (const [cell, table] of tables()) cells[cell] = encodeSlowdowns(table.slowdowns, options.levels);
      return { precision: options.precision, levels: options.levels, cells };
    },
  };
}
