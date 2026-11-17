import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRoadRows } from '../pipeline/build/route-graph';
import { addPlace, addRoads, type CellGrid } from '../pipeline/build/traffic-features';

export function loadGrid(work: string, plate: string): CellGrid {
  const grid: CellGrid = new Map();
  addRoads(grid, parseRoadRows(readFileSync(join(work, 'roads', plate, 'roads.jsonl'), 'utf8')).ways);
  const places = join(work, 'overture', `${plate}.rows.jsonl`);
  if (existsSync(places)) {
    for (const line of readFileSync(places, 'utf8').split('\n')) {
      if (line === '') continue;
      const row = JSON.parse(line) as { lon: number; lat: number; g?: string };
      addPlace(grid, row.lon, row.lat, row.g ?? '');
    }
  }
  return grid;
}
