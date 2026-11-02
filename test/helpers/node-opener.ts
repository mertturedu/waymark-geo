import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClockPort } from '../../src/core/packs/ports';
import type { SqlDb } from '../../src/core/ports';
import { openSqlite } from '../../src/node/sqlite';
import type { World } from './pack-world';

export function nodeOpener(world: World): (path: string) => Promise<SqlDb> {
  const dir = mkdtempSync(join(tmpdir(), 'opener-'));
  return async (path) => {
    const bytes = world.env.fs.files.get(path);
    if (!bytes) throw new Error(`no file ${path}`);
    const file = join(dir, path.replace(/\//g, '__'));
    writeFileSync(file, bytes);
    return openSqlite(file);
  };
}

export function manualClock(): ClockPort & { release(): void; sleeps: number[] } {
  const waiting: (() => void)[] = [];
  const sleeps: number[] = [];
  return {
    now: () => 0,
    sleep: (ms) => {
      sleeps.push(ms);
      return new Promise<void>((resolve) => waiting.push(resolve));
    },
    release: () => {
      for (const wake of waiting.splice(0)) wake();
    },
    sleeps,
  };
}
