import type { RouteStore } from '../ports';
import type { PackManager } from './manager';
import type { FsPort } from './ports';

export type ManagedRouteStore = RouteStore & { onChange(listener: (region: string) => void): () => void };

export function createManagedRouteStore(config: { manager: Pick<PackManager, 'installedRegions' | 'installedFile' | 'subscribe'>; fs: Pick<FsPort, 'size' | 'read'> }): ManagedRouteStore {
  const { manager, fs } = config;
  const listeners = new Set<(region: string) => void>();
  let seen = new Map<string, string | null>();

  const snapshot = (): Map<string, string | null> => new Map(manager.installedRegions().map((id) => [id, manager.installedFile(id, 'route')]));
  seen = snapshot();

  manager.subscribe(() => {
    const now = snapshot();
    const changed = new Set<string>();
    for (const [id, path] of now) if ((seen.get(id) ?? null) !== path) changed.add(id);
    for (const id of seen.keys()) if (!now.has(id)) changed.add(id);
    seen = now;
    for (const id of [...changed].sort()) for (const listener of [...listeners]) listener(id);
  });

  return {
    async installed() {
      return manager.installedRegions().filter((id) => manager.installedFile(id, 'route') !== null);
    },
    async read(region) {
      const path = manager.installedFile(region, 'route');
      if (path === null) return null;
      try {
        const size = await fs.size(path);
        return size === null ? null : await fs.read(path, 0, size);
      } catch {
        return null;
      }
    },
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
