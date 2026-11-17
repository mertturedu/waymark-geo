import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PackStore, RouteStore, SqlDb } from '../core/ports';
import { parseManifest } from '../core/region/manifest';
import { openSqlite } from './sqlite';

export async function createNodeRouteStore(packsDir: string): Promise<RouteStore> {
  const manifestPath = join(packsDir, 'manifest-v1.json');
  if (!existsSync(manifestPath)) throw new Error(`${manifestPath} yok`);
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  const fileOf = (region: string): string | null => {
    const path = manifest.regions.find((r) => r.id === region)?.files.find((f) => f.kind === 'route')?.path;
    return path && existsSync(join(packsDir, path)) ? join(packsDir, path) : null;
  };
  return {
    async installed() {
      return manifest.regions.map((r) => r.id).filter((id) => fileOf(id) !== null);
    },
    async read(region) {
      const file = fileOf(region);
      return file ? new Uint8Array(readFileSync(file)) : null;
    },
  };
}

export async function createNodePackStore(packsDir: string): Promise<PackStore> {
  const manifestPath = join(packsDir, 'manifest-v1.json');
  if (!existsSync(manifestPath)) throw new Error(`${manifestPath} yok`);
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  const fileOf = (region: string, kind: 'address' | 'buildings' | 'directory' | 'learned'): string | null => {
    const path = manifest.regions.find((r) => r.id === region)?.files.find((f) => f.kind === kind)?.path;
    return path && existsSync(join(packsDir, path)) ? join(packsDir, path) : null;
  };
  const addressFile = (region: string): string | null => fileOf(region, 'address');
  let listed: string[] | null = null;
  return {
    async installed(): Promise<string[]> {
      listed ??= manifest.regions.map((r) => r.id).filter((id) => addressFile(id) !== null);
      return [...listed];
    },
    async open(region: string): Promise<SqlDb | null> {
      const file = addressFile(region);
      return file ? openSqlite(file) : null;
    },
    async openPart(region: string, kind: 'buildings' | 'directory' | 'buildings2' | 'learned'): Promise<SqlDb | null> {
      if (kind === 'buildings2') return null;
      const file = fileOf(region, kind);
      return file ? openSqlite(file) : null;
    },
  };
}
