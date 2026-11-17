import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInCluster } from '../server/cluster';
import { createGeoServer } from '../server';
import type { Flags } from '../server/api';
import type { ApiKey } from '../server/guard';

export function parseKeys(text: string | undefined): ApiKey[] {
  return (text ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const [id, secret, rps] = entry.split(':');
      if (!id || !secret) throw new Error('GEO_API_KEYS "ad:gizli[:istek/sn],ad2:gizli2" biçiminde olmalı');
      return { id, secret, ...(rps ? { rps: Number(rps) } : {}) };
    });
}

export function parseFlags(text: string | undefined, allow: string | undefined, deny: string | undefined): Flags {
  const list = (value: string | undefined): Record<string, string[]> =>
    Object.fromEntries((value ?? '').split(';').map((part) => part.trim()).filter((part) => part !== '').map((part) => {
      const [name, users] = part.split(':');
      return [name as string, (users ?? '').split('|').map((u) => u.trim()).filter((u) => u !== '')];
    }));
  const allowed = list(allow);
  const denied = list(deny);
  return Object.fromEntries((text ?? '').split(',').map((entry) => entry.trim()).filter((entry) => entry !== '').map((entry) => {
    const [name, percent] = entry.split('=');
    const value = Number(percent);
    if (!name || !Number.isFinite(value) || value < 0 || value > 100) throw new Error('GEO_FLAGS "ad=yüzde,ad2=yüzde" biçiminde olmalı (0-100)');
    return [name, { percent: value, ...(allowed[name] ? { allow: allowed[name] } : {}), ...(denied[name] ? { deny: denied[name] } : {}) }];
  }));
}

async function serve(): Promise<void> {
  const packsDir = process.env.GEO_PACKS_DIR ?? join(process.cwd(), 'dist', 'packs-0.8-adres');
  const keys = parseKeys(process.env.GEO_API_KEYS);
  if (!existsSync(packsDir)) throw new Error(`paket dizini yok: ${packsDir}`);
  if (keys.length === 0) throw new Error('GEO_API_KEYS boş: en az bir anahtar gerekli');
  const server = createGeoServer({
    packsDir,
    keys,
    flags: () => parseFlags(process.env.GEO_FLAGS, process.env.GEO_FLAGS_ALLOW, process.env.GEO_FLAGS_DENY),
    ...(process.env.GEO_MAX_OPEN ? { maxOpen: Number(process.env.GEO_MAX_OPEN) } : {}),
    ...(process.env.GEO_IDLE_MS ? { idleMs: Number(process.env.GEO_IDLE_MS) } : {}),
    log: (line) => console.log(line),
  });
  const port = await server.listen(Number(process.env.PORT ?? 8096), process.env.HOST ?? '127.0.0.1');
  console.log(`geo sunucusu ${process.env.HOST ?? '127.0.0.1'}:${port}, ${(await server.store.installed()).length} il`);
}

const main = (): Promise<void> => runInCluster({ workers: Number(process.env.GEO_WORKERS ?? 1), log: (line) => console.log(line) }, serve);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
