import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cellOfGeohash, featuresOf } from '../pipeline/build/traffic-features';
import { trainTrafficModel } from '../pipeline/build/traffic-model';
import { compactModel } from '../pipeline/build/traffic-predict';
import { createProfileBuilder } from '../pipeline/build/traffic-profile';
import { loadGrid } from './traffic-grid';
import { readSpeedRows } from './traffic-rows';

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? (process.argv[at + 1] as string) : fallback;
};

const data = arg('data', join('dist', 'work', 'traffic', 'ibb'));
const out = arg('out', join('pipeline', 'data', 'traffic-model.json'));
const builder = createProfileBuilder();
await readSpeedRows(readdirSync(data).filter((name) => name.endsWith('.csv')).sort().map((name) => join(data, name)), (row) => builder.add(row));
const tables = [...builder.tables()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
const grid = loadGrid(arg('work', join('dist', 'work', '261028')), '34');
const model = compactModel(trainTrafficModel(tables.map(([cell]) => featuresOf(grid, ...cellOfGeohash(cell))), tables.map(([, table]) => table.slowdowns)));
writeFileSync(out, JSON.stringify(model));
console.log(`${tables.length} hücreyle eğitildi: ${out}`);
