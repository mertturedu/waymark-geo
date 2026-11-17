import { createPackManager, type PackManager } from '../../src/core/packs/manager';
import type { DecodePort, NetPort } from '../../src/core/packs/ports';
import { makeWorld, type World } from './pack-world';

export type SetupOptions = { autoDownload?: 'ask' | 'wifi' | 'always' | 'never'; patches?: boolean; net?: NetPort; decode?: DecodePort };

export async function setup(world: World = makeWorld(), options: SetupOptions = {}): Promise<{ world: World; manager: PackManager }> {
  const { net, decode, ...rest } = options;
  const manager = await createPackManager({ fs: world.env.fs, net: net ?? world.env.net, hash: world.env.hash, clock: world.env.clock, connectivity: world.env.connectivity, ...(decode ? { decode } : {}) }, { ...world.config, ...rest });
  return { world, manager };
}

export const requested = (world: World): string[] => world.env.server.log.map((r) => r.url.replace(`${world.baseUrl}/`, ''));
export const stored = (world: World, path: string): number[] => Array.from(world.env.fs.files.get(path) ?? []);
