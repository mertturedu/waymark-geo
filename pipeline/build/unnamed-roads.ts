import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { componentsOf, indexOf, type Chain, type Index, type Pt } from './building-link';

export const ROAD_LINK_M = 150;

export type RoadRow = { id: number; hood: number | null; path: Pt[] };
export type UnnamedRoads = { roads: RoadRow[]; index: Index };

type Way = { id: string; lines: Pt[][]; neighbourhood?: string | null };

const lines = <T>(path: string): T[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as T) : []);

export function loadUnnamedRoads(workDir: string, plate: string, hoodAt: (lon: number, lat: number) => number | null): UnnamedRoads {
  const derived = new Set(lines<{ ways?: string[] }>(join(workDir, 'street-names', `${plate}.jsonl`)).flatMap((r) => r.ways ?? []));
  const byHood = new Map<number, Pt[][]>();
  for (const way of lines<Way>(join(workDir, 'unnamed', `${plate}.jsonl`))) {
    if (derived.has(way.id)) continue;
    const first = way.lines[0]?.[0];
    if (!first) continue;
    const hood = hoodAt(first[0], first[1]) ?? 0;
    byHood.set(hood, [...(byHood.get(hood) ?? []), ...way.lines]);
  }
  const groups = [...byHood].sort((a, b) => a[0] - b[0]);
  const chains: Chain[] = groups.map(([, list], i) => ({ id: i + 1, name: '', lines: list }));
  const components = componentsOf(chains);
  const roads = components.map((c, i) => ({ id: i + 1, hood: (groups[c.chain - 1] as [number, Pt[][]])[0] || null, path: c.path }));
  return { roads, index: indexOf(components) };
}
