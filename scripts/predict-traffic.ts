import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cellOfGeohash, cellKey, type CellGrid } from '../pipeline/build/traffic-features';
import type { TrafficModel } from '../pipeline/build/traffic-model';
import { predictProfile } from '../pipeline/build/traffic-predict';
import { createBorders } from '../src/core/region/borders';
import { bandOf, type TrafficBand } from '../src/core/traffic/model';
import type { ObservedProfile } from '../src/core/traffic/observed';
import { loadGrid } from './traffic-grid';

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? (process.argv[at + 1] as string) : fallback;
};

const BANDS: TrafficBand[] = ['smooth', 'busy', 'heavy', 'jam'];
const MAIN_GROUPS = 6;

export function profileStats(profile: ObservedProfile, grid: CellGrid, slot: number): { cells: number; mean: number; shares: number[] } {
  let weight = 0;
  let sum = 0;
  const shares = [0, 0, 0, 0];
  for (const [cell, text] of Object.entries(profile.cells)) {
    const values = grid.get(cellKey(...cellOfGeohash(cell)));
    let km = 0;
    for (let k = 0; k < MAIN_GROUPS; k++) km += values?.[k] ?? 0;
    const slowdown = parseInt(text[slot] as string, 36) / profile.levels;
    weight += km;
    sum += slowdown * km;
    (shares[BANDS.indexOf(bandOf(slowdown))] as number) += km;
  }
  return { cells: Object.keys(profile.cells).length, mean: sum / weight, shares: shares.map((v) => v / weight) };
}

const work = arg('work', join('dist', 'work', '261028'));
const out = arg('out', join('dist', 'work', 'traffic', 'profiles'));
const model = JSON.parse(readFileSync(arg('model', join('pipeline', 'data', 'traffic-model.json')), 'utf8')) as TrafficModel;
const borders = createBorders(readFileSync(join('src', 'core', 'region', 'data', 'borders.bin')));
mkdirSync(out, { recursive: true });
const pct = (value: number): string => `${(value * 100).toFixed(0)}%`.padStart(4);
for (const plate of arg('plates', '34').split(',')) {
  const grid = loadGrid(work, plate);
  const profile = predictProfile(model, grid, (lon, lat) => borders.provinceAt(lon, lat) === plate);
  const text = JSON.stringify(profile);
  writeFileSync(join(out, `${plate}.json`), text);
  const show = (slot: number): string => {
    const stats = profileStats(profile, grid, slot);
    return `ort ${stats.mean.toFixed(3)} [${stats.shares.map(pct).join(' ')}]`;
  };
  console.log(`${plate}: ${String(Object.keys(profile.cells).length).padStart(6)} hücre, ${(text.length / 1024).toFixed(0).padStart(5)} KB | 03:00 ${show(3)} | 08:00 ${show(8)} | 13:00 ${show(13)} | 18:00 ${show(18)} | paz 15:00 ${show(63)}`);
}
