import { access, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LearnStore, StoreRow } from '../core/learn/store';

const isRows = (value: unknown): value is { rows: Record<string, string> } =>
  typeof value === 'object' && value !== null && typeof (value as { rows?: unknown }).rows === 'object' && (value as { rows?: unknown }).rows !== null && Object.values((value as { rows: Record<string, unknown> }).rows).every((v) => typeof v === 'string');

const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

let counter = 0;

export function fileStore(path: string): LearnStore {
  let rows: Map<string, string> | null = null;
  let queue: Promise<void> = Promise.resolve();

  const keepCopy = async (): Promise<void> => {
    let target = `${path}.bak`;
    for (let n = 1; await exists(target); n++) target = `${path}.bak.${n}`;
    await copyFile(path, target);
  };

  const load = async (): Promise<Map<string, string>> => {
    if (rows) return rows;
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return (rows = new Map());
      throw error;
    }
    const loaded = new Map<string, string>();
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isRows(parsed)) throw new Error('shape');
      for (const [key, value] of Object.entries(parsed.rows)) loaded.set(key, value);
    } catch {
      await keepCopy();
    }
    return (rows = loaded);
  };

  const save = async (map: Map<string, string>): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${counter++}.tmp`;
    await writeFile(temp, JSON.stringify({ rows: Object.fromEntries([...map].sort((a, b) => (a[0] < b[0] ? -1 : 1))) }));
    await rename(temp, path);
  };

  const exclusive = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job);
    queue = next.then(() => undefined, () => undefined);
    return next;
  };

  const change = (edit: (map: Map<string, string>) => boolean): Promise<void> =>
    exclusive(async () => {
      const current = await load();
      const next = new Map(current);
      if (!edit(next)) return;
      await save(next);
      rows = next;
    });

  return {
    readAll: () =>
      exclusive(async (): Promise<StoreRow[]> => [...(await load())].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, value]) => ({ key, value }))),
    write: (key, value) => change((map) => (map.set(key, value), true)),
    remove: (key) => change((map) => map.delete(key)),
  };
}
