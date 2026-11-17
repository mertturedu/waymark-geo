import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kiyasDir } from './measures';
import type { EngineResult } from './types';

const dirOf = (): string => join(kiyasDir(), 'onbellek');
const stores = new Map<string, Map<string, EngineResult>>();

function load(name: string): Map<string, EngineResult> {
  const known = stores.get(name);
  if (known) return known;
  const map = new Map<string, EngineResult>();
  const file = join(dirOf(), `${name}.jsonl`);
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const [key, value] = JSON.parse(line) as [string, EngineResult];
        map.set(key, value);
      } catch {
        continue;
      }
    }
  }
  stores.set(name, map);
  return map;
}

export async function cached(name: string, key: string, run: () => Promise<EngineResult>): Promise<EngineResult> {
  const map = load(name);
  const hit = map.get(key);
  if (hit) return hit;
  const value = await run();
  map.set(key, value);
  mkdirSync(dirOf(), { recursive: true });
  appendFileSync(join(dirOf(), `${name}.jsonl`), `${JSON.stringify([key, value])}\n`);
  return value;
}

export const peek = (name: string, key: string): EngineResult | undefined => load(name).get(key);
