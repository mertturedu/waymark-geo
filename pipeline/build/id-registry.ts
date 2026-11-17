import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export type RegistryEntry = { k: string; sid: string; ways: string[] };
export type Registry = {
  byKey: Map<string, RegistryEntry>;
  byWay: Map<string, string[]>;
  fresh: RegistryEntry[];
  renamed: { from: string; to: string; sid: string }[];
};

export const MAX_WAYS = 12;
export const MIN_OVERLAP = 0.5;

const lines = (path: string): string[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []);

export function loadRegistry(dir: string, plate: string): Registry {
  const registry: Registry = { byKey: new Map(), byWay: new Map(), fresh: [], renamed: [] };
  for (const line of lines(join(dir, `${plate}.jsonl`))) {
    const entry = JSON.parse(line) as RegistryEntry & { alias?: string };
    index(registry, { k: entry.k, sid: entry.sid, ways: entry.ways ?? [] });
  }
  return registry;
}

function index(registry: Registry, entry: RegistryEntry): void {
  registry.byKey.set(entry.k, entry);
  for (const way of entry.ways) {
    const list = registry.byWay.get(way);
    if (list) {
      if (!list.includes(entry.k)) list.push(entry.k);
    } else registry.byWay.set(way, [entry.k]);
  }
}

export function assignId(registry: Registry, claimed: Set<string>, key: string, ways: string[], create: () => string): string {
  const known = registry.byKey.get(key);
  if (known) {
    claimed.add(known.sid);
    return known.sid;
  }
  const clipped = [...new Set(ways)].slice(0, MAX_WAYS);
  const votes = new Map<string, number>();
  for (const way of clipped) for (const k of registry.byWay.get(way) ?? []) votes.set(k, (votes.get(k) ?? 0) + 1);
  let best: RegistryEntry | null = null;
  let bestShare = 0;
  for (const [k, n] of votes) {
    const entry = registry.byKey.get(k) as RegistryEntry;
    if (claimed.has(entry.sid)) continue;
    const share = n / Math.min(clipped.length, Math.max(1, entry.ways.length));
    if (share >= MIN_OVERLAP && share > bestShare) {
      best = entry;
      bestShare = share;
    }
  }
  const sid = best ? best.sid : create();
  const entry: RegistryEntry = { k: key, sid, ways: clipped };
  index(registry, entry);
  registry.fresh.push(entry);
  claimed.add(sid);
  if (best) registry.renamed.push({ from: best.k, to: key, sid });
  return sid;
}

export function saveRegistry(dir: string, plate: string, registry: Registry): void {
  if (registry.fresh.length === 0) return;
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${plate}.jsonl`), registry.fresh.map((e) => JSON.stringify(e)).join('\n') + '\n');
  registry.fresh = [];
}
