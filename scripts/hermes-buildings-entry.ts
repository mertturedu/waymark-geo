import cases from '../dist/addr-eval/20261028.20261030.3/device/buildings2-34.json';
import dump from '../dist/addr-eval/20261028.20261030.3/device/buildings2-34.dump.json';
import { openBuildings2 } from '../src/core/address/buildings2';
import type { SqlDb } from '../src/core/ports';

declare const print: ((text: string) => void) | undefined;

type Table = Record<string, unknown>[];
const tables = dump as unknown as Record<string, Table>;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < clean.length; i++) {
    buffer = (buffer << 6) | ALPHABET.indexOf(clean.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (buffer >> bits) & 255;
    }
  }
  return out;
}

const bytes = (v: unknown): unknown => (v && typeof v === 'object' && 'b64' in (v as object) ? base64((v as { b64: string }).b64) : v);
const decoded: Record<string, Table> = {};
for (const [name, rows] of Object.entries(tables)) decoded[name] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, bytes(v)])));

const db: SqlDb = {
  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows = (name: string): Table => decoded[name] as Table;
    if (sql.includes('FROM meta')) return rows('meta') as T[];
    if (sql.includes('FROM building_cell')) return rows('building_cell').filter((r) => params.includes(r.cell)) as T[];
    if (sql.includes('FROM building WHERE id IN')) return rows('building').filter((r) => params.includes(r.id)).sort((a, b) => (a.id as number) - (b.id as number)) as T[];
    if (sql.includes('FROM building WHERE chain')) {
      const side = params[1];
      return rows('building').filter((r) => r.chain === params[0] && (side === undefined || r.side === side)).sort((a, b) => (b.side as number) - (a.side as number) || (a.seq as number) - (b.seq as number) || (a.id as number) - (b.id as number)) as T[];
    }
    return [] as T[];
  },
  close: async () => undefined,
} as unknown as SqlDb;

const perf = (globalThis as { performance?: { now(): number } }).performance;
const clock: () => number = perf ? () => perf.now() : () => Date.now();

async function run(): Promise<void> {
  const reader = await openBuildings2(db);
  const times: number[] = [];
  let different = 0;
  const REPEAT = 20;
  for (const c of cases as { kind: string; point?: [number, number]; chain?: number; side?: 'left' | 'right'; expected: unknown }[]) {
    if (c.kind === 'at') {
      const started = clock();
      let got = null;
      for (let i = 0; i < REPEAT; i++) got = await reader.at(c.point as [number, number]);
      times.push((clock() - started) / REPEAT);
      const summary = got ? { gid: got.gid, levels: got.levels, chain: got.chain, side: got.side, sequence: got.sequence } : null;
      if (JSON.stringify(summary) !== JSON.stringify(c.expected)) different++;
    } else if (c.kind === 'near') {
      const near = await reader.near(c.point as [number, number], 40, 5);
      if (JSON.stringify(near.map((n) => n.building.gid)) !== JSON.stringify(c.expected)) different++;
    } else {
      const list = await reader.ofStreet(c.chain as number, c.side);
      if (JSON.stringify(list.map((b) => [b.gid, b.sequence])) !== JSON.stringify(c.expected)) different++;
    }
  }
  times.sort((a, b) => a - b);
  const text = JSON.stringify({ total: (cases as unknown[]).length, different, p50: times[Math.floor(times.length * 0.5)], p95: times[Math.floor(times.length * 0.95)], max: times[times.length - 1], runtime: 'hermes' });
  if (typeof print === 'function') print(text);
  else console.log(text);
}

void run();
