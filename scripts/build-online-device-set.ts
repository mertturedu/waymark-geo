import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { provinceName } from '../src/core/text/admin';
import { rng, shuffle } from '../test/sim/random';
import { readSet, setsDir, type TextRecord } from './addr-sets';

export const ONLINE_PLATE = '41';
export const ONLINE_CASES = 40;
export const ONLINE_KEY = process.env.GEO_DEVICE_KEY ?? 'cihaz-deneme-anahtari';

export type OnlineSet = { plate: string; city: string; key: string; port: number; texts: string[] };

export function onlineSet(): OnlineSet {
  const records = shuffle(readSet<TextRecord>('g2', ONLINE_PLATE), rng(2121)).slice(0, ONLINE_CASES);
  return { plate: ONLINE_PLATE, city: provinceName(ONLINE_PLATE) ?? ONLINE_PLATE, key: ONLINE_KEY, port: Number(process.env.GEO_DEVICE_PORT ?? 8096), texts: records.map((r) => r.text) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  const set = onlineSet();
  writeFileSync(join(dir, 'online.json'), JSON.stringify(set));
  console.log(JSON.stringify({ file: join(dir, 'online.json'), texts: set.texts.length, port: set.port }));
}
