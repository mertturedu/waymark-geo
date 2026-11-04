import { closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions } from '../../src/core/packs/verify';
import { MLT_SUFFIX } from '../../src/core/region/manifest';
import { gunzipSync } from 'node:zlib';
import { decodeLayer, decodeTile, encodeLayer, encodeTile } from './mvt';
import { gzipStable, openPmtiles, rewritePmtiles, writePmtiles } from './pmtiles-file';
import { defaultRunner, type Runner } from './tiles';

export type TileFormat = 'mvt' | 'mlt';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
export const mltBin = join(repoRoot, 'pipeline', 'bin', 'mlt');
export const MLT_ARGS = ['--profile', 'native', '--tessellate=off', '--tile-compression', 'gzip', '--no-fastpfor', '--no-fsst', '--verify'];
export const MLT_MIN_SDK = '0.6.0';
const MLT_TILE_TYPE = 6;

export function tileFormat(wanted: string | undefined = process.env.GEO_TILE_FORMAT): TileFormat {
  if (wanted === undefined || wanted === '' || wanted === 'mvt') return 'mvt';
  if (wanted === 'mlt') return 'mlt';
  throw new Error(`GEO_TILE_FORMAT mvt ya da mlt olmalı: ${wanted}`);
}

export function isMlt(path: string): boolean {
  const head = Buffer.alloc(100);
  const fd = openSync(path, 'r');
  try {
    if (readSync(fd, head, 0, 100, 0) < 100 || head.toString('latin1', 0, 7) !== 'PMTiles') return false;
  } finally {
    closeSync(fd);
  }
  return head[99] === MLT_TILE_TYPE;
}

export const nameMatchesFormat = (path: string, full: string): boolean => isMlt(full) === path.endsWith(MLT_SUFFIX);

export function tilesMinSdk(paths: string[], floor = '0.3.0'): string {
  return paths.some(isMlt) && compareVersions(MLT_MIN_SDK, floor) > 0 ? MLT_MIN_SDK : floor;
}

export function stripFeatureIds(source: string, target: string): number {
  const archive = openPmtiles(source);
  try {
    const { header } = archive;
    const gzip = header.tileCompression === 2;
    let stripped = 0;
    const done = new Map<number, Uint8Array>();
    const tiles: { tileId: number; data: Uint8Array }[] = [];
    for (const entry of archive.entries) {
      let data = done.get(entry.offset);
      if (!data) {
        const raw = gzip ? gunzipSync(archive.read(entry)) : archive.read(entry);
        const { layers, foreign } = decodeTile(raw);
        const lean = layers.map((bytes) => {
          const layer = decodeLayer(bytes);
          if (!layer) return bytes;
          for (const feature of layer.features) {
            if (feature.id) stripped += 1;
            feature.id = null;
          }
          return encodeLayer(layer);
        });
        const tile = foreign > 0 ? raw : encodeTile(lean);
        data = gzip ? gzipStable(tile) : tile;
        done.set(entry.offset, data);
      }
      for (let i = 0; i < entry.runLength; i++) tiles.push({ tileId: entry.tileId + i, data });
    }
    mkdirSync(dirname(target), { recursive: true });
    writePmtiles(target, { tileCompression: header.tileCompression, tileType: header.tileType, minZoom: header.minZoom, maxZoom: header.maxZoom, boundsE7: header.boundsE7, centerZoom: header.centerZoom, centerE7: header.centerE7 }, archive.metadata, tiles);
    return stripped;
  } finally {
    archive.close();
  }
}

export async function encodeMlt(input: { source: string; target: string; run?: Runner; keepIds?: boolean }): Promise<void> {
  const run = input.run ?? defaultRunner;
  mkdirSync(dirname(input.target), { recursive: true });
  const temporary = `${input.target}.tmp.pmtiles`;
  const plain = `${input.target}.ids.pmtiles`;
  rmSync(temporary, { force: true });
  rmSync(plain, { force: true });
  const source = input.keepIds === true ? input.source : (stripFeatureIds(input.source, plain), plain);
  const { code, out } = await run(mltBin, ['convert', ...MLT_ARGS, source, temporary]);
  rmSync(plain, { force: true });
  if (code !== 0 || !existsSync(temporary)) {
    rmSync(temporary, { force: true });
    throw new Error(`mlt convert ${input.source}: ${out.slice(-400)}`);
  }
  if (!isMlt(temporary)) {
    rmSync(temporary, { force: true });
    throw new Error(`mlt convert ${input.source}: çıktı MLT arşivi değil`);
  }
  const normal = `${input.target}.norm.pmtiles`;
  try {
    rewritePmtiles(temporary, normal);
  } catch (error) {
    rmSync(normal, { force: true });
    throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
  renameSync(normal, input.target);
}

export async function encodeAll(input: { plates: string[]; files: (plate: string) => { source: string; target: string }[]; run?: Runner; log?: (line: string) => void }): Promise<number> {
  let count = 0;
  for (const plate of input.plates) {
    for (const file of input.files(plate)) {
      if (!existsSync(file.source)) {
        rmSync(file.target, { force: true });
        continue;
      }
      await encodeMlt({ ...file, ...(input.run ? { run: input.run } : {}) });
      count += 1;
    }
    input.log?.(`mlt ${plate}`);
  }
  return count;
}
