import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openSearch } from './addr-eval';
import { readSet, setsDir, type TextRecord } from './addr-sets';

export const DEVICE_COUNT = 300;

export type DeviceCase = { id: string; text: string; truth: [number, number]; expected: { status: string; point: [number, number] | null; precision: string | null } };

export async function buildDeviceSet(plate: string, count = DEVICE_COUNT): Promise<DeviceCase[]> {
  const search = await openSearch(undefined, false, [plate]);
  const records = readSet<TextRecord>('g2', plate).filter((r) => r.source === 'osm').slice(0, count);
  const out: DeviceCase[] = [];
  for (const r of records) {
    const result = await search.resolve(r.text);
    const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
    out.push({ id: r.id, text: r.text, truth: [r.lng, r.lat], expected: { status: result.status, point: best ? best.coordinate : null, precision: best?.precision ?? null } });
  }
  return out;
}

async function main(): Promise<void> {
  const plate = process.argv[2] ?? '34';
  const cases = await buildDeviceSet(plate);
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${plate}.json`), JSON.stringify(cases));
  console.log(`${plate}: ${cases.length} vaka → ${join(dir, `${plate}.json`)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
