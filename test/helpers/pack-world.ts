import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { generateKeyPairSync } from 'node:crypto';
import { signManifest } from '../../pipeline/build/manifest';
import { serializeManifest, type Manifest, type ManifestFile, type ManifestRegion } from '../../src/core/region/manifest';
import { createFakeEnv, type FakeEnv } from './fake-env';

type Part = 'address' | 'tiles' | 'buildings' | 'places' | 'route';

export type WorldRegion = { id: string; tier?: 'full' | 'basic'; parts: Partial<Record<Part, Uint8Array>> };

export const blob = (size: number, seed = 1): Uint8Array => Uint8Array.from({ length: size }, (_, i) => (i * 13 + seed * 7 + (i >> 7)) & 255);

const EXTENSION: Record<Part, string> = { address: 'sqlite', tiles: 'pmtiles', buildings: 'sqlite', places: 'pmtiles', route: 'bin' };
const BASE_URL = 'https://packs.example/v1';

export type World = {
  env: FakeEnv;
  baseUrl: string;
  manifestUrl: string;
  config: { manifestUrl: string; publicKeys: string[]; sdkVersion: string };
  regions: WorldRegion[];
  base: Record<string, Uint8Array>;
  publish(patch?: { format?: number; minSdk?: string; tamper?: boolean }): Manifest;
  setPart(id: string, kind: Part, bytes: Uint8Array): void;
  setBuild(build: string): void;
  pathOf(id: string, kind: Part): string;
  signWith(text: string): string;
};

export function makeWorld(options: { regions?: WorldRegion[]; base?: Record<string, Uint8Array>; capacity?: number } = {}): World {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = String(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const publicPem = String(publicKey.export({ type: 'spki', format: 'pem' }));
  const env = createFakeEnv(options.capacity === undefined ? {} : { capacity: options.capacity });
  const regions: WorldRegion[] = options.regions ?? [
    { id: '34', parts: { address: blob(30_000, 1), tiles: blob(50_000, 2), buildings: blob(8_000, 3) } },
    { id: '35', tier: 'full', parts: { address: blob(20_000, 4), tiles: blob(40_000, 5) } },
    { id: '06', tier: 'basic', parts: { address: blob(10_000, 6), tiles: blob(25_000, 7) } },
  ];
  const base = options.base ?? { 'overview.pmtiles': blob(9_000, 8), 'sprites/v4/light.json': blob(300, 9) };
  let day = 20261020;
  let build = '20261022';

  const fileOf = (id: string, kind: Part, bytes: Uint8Array): ManifestFile => {
    const sha = bytesToHex(sha256(bytes));
    const path = `${id}/${kind}-${sha.slice(0, 8)}.${EXTENSION[kind]}`;
    env.server.put(`${BASE_URL}/${path}`, bytes);
    return { kind, path, size: bytes.length, sha256: sha };
  };

  const world: World = {
    env,
    baseUrl: BASE_URL,
    manifestUrl: `${BASE_URL}/manifest-v1.json`,
    config: { manifestUrl: `${BASE_URL}/manifest-v1.json`, publicKeys: [publicPem], sdkVersion: '0.1.0' },
    regions,
    base,
    signWith: (text) => signManifest(text, privatePem),
    setPart(id, kind, bytes) {
      const region = regions.find((r) => r.id === id);
      if (!region) throw new Error(`no region ${id}`);
      region.parts[kind] = bytes;
      day += 1;
    },
    setBuild(next) {
      build = next;
    },
    pathOf(id, kind) {
      const bytes = regions.find((r) => r.id === id)?.parts[kind];
      if (!bytes) throw new Error(`no part ${id}/${kind}`);
      return `${id}/${kind}-${bytesToHex(sha256(bytes)).slice(0, 8)}.${EXTENSION[kind]}`;
    },
    publish(patch = {}) {
      const baseFiles: ManifestFile[] = Object.entries(base)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([rel, bytes]) => {
          const sha = bytesToHex(sha256(bytes));
          const path = `base-${build}/${rel}`;
          env.server.put(`${BASE_URL}/${path}`, bytes);
          return { kind: 'base', path, size: bytes.length, sha256: sha };
        });
      const manifestRegions: ManifestRegion[] = [...regions]
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((region) => ({
          id: region.id,
          tier: region.tier ?? 'full',
          names: { tr: `Il ${region.id}` },
          bbox: [27, 40, 30, 42],
          version: `${day}.${build}`,
          stats: { addresses: 1, streets: 1, neighbourhoods: 1 },
          files: (Object.keys(region.parts) as Part[]).sort().map((kind) => fileOf(region.id, kind, region.parts[kind] as Uint8Array)),
        }));
      const manifest: Manifest = {
        format: 1,
        minSdk: patch.minSdk ?? '0.1.0',
        osm: { file: 'turkey-261020.osm.pbf', time: '2026-10-20T20:23:47Z' },
        tiles: { build, time: '2026-10-22T04:00:00Z' },
        base: baseFiles,
        regions: manifestRegions,
      };
      const text = serializeManifest({ ...manifest, format: (patch.format ?? 1) as 1 });
      const signature = world.signWith(text);
      env.server.put(world.manifestUrl, new TextEncoder().encode(patch.tamper ? `${text} ` : text));
      env.server.put(`${world.manifestUrl}.sig`, new TextEncoder().encode(signature));
      return manifest;
    },
  };
  world.publish();
  return world;
}
