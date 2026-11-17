import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildAddressPack } from '../../../pipeline/build/address-pack';
import { address, baseRows, part, where, writeWork } from './mini-work';

export const east = (lng: number, lat: number, meters: number): [number, number] => [lng + meters / (111_195 * Math.cos((lat * Math.PI) / 180)), lat];

export function buildingFile(work: string, plate: string, list: { id: string; lon: number; lat: number }[]): void {
  const path = join(work, 'buildings', plate, 'buildings.jsonl');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, list.map((b) => JSON.stringify({ area_m2: 120, building: 'yes', ...b })).join('\n') + '\n');
}

export async function buildingSetup(onCentres: boolean, free: { id: string; lon: number; lat: number }[]): Promise<{ work: string; pack: string; out: string }> {
  const rows = baseRows();
  rows.addresses = [];
  rows.streets = [part('Gül Sokak', where('r10', 'r20'), [[[28.6, 40.7], [28.62, 40.7]]], ['w1'])];
  for (let i = 0; i < 10; i++) rows.addresses.push(address(`n${900 + i}`, 'Gül Sokak', String(2 * (i + 1)), 28.6 + i * 0.001, 40.7002, where('r10', 'r20')));
  const work = writeWork(rows);
  const pack = join(work, 'pack.sqlite');
  await buildAddressPack({ province: '34', workDir: work, outFile: pack, osmTimestamp: 't' });
  const list = rows.addresses.map((a, i) => {
    const row = a as { lon: number; lat: number };
    const [lon, lat] = onCentres ? [row.lon, row.lat] : east(row.lon, row.lat, 40);
    return { id: `w${i}`, lon, lat };
  });
  buildingFile(work, '34', [...list, ...free]);
  return { work, pack, out: join(mkdtempSync(join(tmpdir(), 'bpack-')), 'buildings.sqlite') };
}
