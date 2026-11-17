import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nameKey } from '../src/core/text';
import { openSearch } from './addr-eval';
import { readSet, setsDir, type TextRecord } from './addr-sets';

export const ADMIN_DEVICE_COUNT = 100;

export type AdminCase = { id: string; text: string; kind: 'old_name' | 'district_wrong'; hood: string; expected: { status: string; point: [number, number] | null; hood: string | null; notes: string[] } };

export async function buildAdminSet(plate: string, count = ADMIN_DEVICE_COUNT): Promise<AdminCase[]> {
  const search = await openSearch(undefined, false, [plate]);
  const picks: [AdminCase['kind'], TextRecord[]][] = [
    ['old_name', readSet<TextRecord>('g2a', plate).slice(0, count)],
    ['district_wrong', readSet<TextRecord>('g2', plate).filter((r) => r.ops.includes('district_wrong') && r.hood).slice(0, count)],
  ];
  const out: AdminCase[] = [];
  for (const [kind, records] of picks) {
    for (const r of records) {
      const result = await search.resolve(r.text);
      const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
      out.push({ id: r.id, text: r.text, kind, hood: nameKey(r.hood as string), expected: { status: result.status, point: best ? best.coordinate : null, hood: best?.components.neighbourhood ?? null, notes: best?.notes ?? [] } });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const plate = process.argv[2] ?? '34';
  const cases = await buildAdminSet(plate);
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `admin-${plate}.json`), JSON.stringify(cases));
  console.log(`${plate}: ${cases.length} vaka`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
