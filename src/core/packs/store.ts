import type { PackStore, SqlDb } from '../ports';
import type { PackManager } from './manager';
import type { ClockPort } from './ports';

export type ManagedPackStore = PackStore & {
  onChange(listener: (plate: string) => void): () => void;
  closeAll(): Promise<void>;
};

type Entry = { plate: string; path: string; db: Promise<SqlDb | null> };

const DEFAULT_GRACE_MS = 30_000;

export function createManagedPackStore(config: { manager: PackManager; opener: (path: string) => Promise<SqlDb>; clock: ClockPort; graceMs?: number }): ManagedPackStore {
  const { manager, opener, clock } = config;
  const grace = config.graceMs ?? DEFAULT_GRACE_MS;
  const entries = new Map<string, Entry>();
  const failed = new Set<string>();
  const listeners = new Set<(plate: string) => void>();

  const keyOf = (plate: string, kind: string): string => `${plate}/${kind}`;

  const retire = (entry: Entry): void => {
    void entry.db.then(async (db) => {
      if (!db) return;
      await clock.sleep(grace);
      await db.close().catch(() => undefined);
    });
  };

  const KINDS = ['address', 'buildings', 'directory'] as const;
  const seen = new Map<string, string | null>();
  const snapshot = (): void => {
    for (const plate of manager.installedRegions()) for (const kind of KINDS) seen.set(keyOf(plate, kind), manager.installedFile(plate, kind));
  };
  snapshot();

  const sync = (): void => {
    const changed = new Set<string>();
    for (const [key, entry] of [...entries]) {
      const kind = key.slice(key.indexOf('/') + 1);
      if (manager.installedFile(entry.plate, kind as 'address') === entry.path) continue;
      entries.delete(key);
      failed.delete(key);
      retire(entry);
      changed.add(entry.plate);
    }
    const plates = new Set([...manager.installedRegions(), ...[...seen.keys()].map((key) => key.slice(0, key.indexOf('/')))]);
    for (const plate of plates) {
      const hadAddress = (seen.get(keyOf(plate, 'address')) ?? null) !== null;
      for (const kind of KINDS) {
        const key = keyOf(plate, kind);
        const now = manager.installedFile(plate, kind) ?? null;
        if (hadAddress && (seen.get(key) ?? null) !== now) changed.add(plate);
        seen.set(key, now);
      }
    }
    for (const plate of [...changed].sort()) {
      for (const listener of [...listeners]) {
        try {
          listener(plate);
        } catch {
          continue;
        }
      }
    }
  };
  manager.subscribe(sync);

  const openKind = async (plate: string, kind: 'address' | 'buildings' | 'directory'): Promise<SqlDb | null> => {
    const path = manager.installedFile(plate, kind);
    if (!path) return null;
    const key = keyOf(plate, kind);
    let entry = entries.get(key);
    if (entry && entry.path !== path) {
      retire(entry);
      entry = undefined;
    }
    if (!entry) {
      const created: Entry = {
        plate,
        path,
        db: opener(path).catch(() => {
          failed.add(key);
          return null;
        }),
      };
      entries.set(key, created);
      failed.delete(key);
      entry = created;
    }
    return entry.db;
  };

  return {
    async installed() {
      return manager.installedRegions().filter((plate) => !failed.has(keyOf(plate, 'address')));
    },
    open: (plate) => openKind(plate, 'address'),
    openPart: (plate, kind) => openKind(plate, kind),
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async closeAll() {
      const open = [...entries.values()];
      entries.clear();
      failed.clear();
      for (const entry of open) {
        const db = await entry.db;
        await db?.close();
      }
    },
  };
}
