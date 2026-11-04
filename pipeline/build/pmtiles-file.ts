import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync, renameSync, rmSync, writeSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';

export type PmtilesHeader = {
  rootOffset: number;
  rootLength: number;
  metadataOffset: number;
  metadataLength: number;
  leafOffset: number;
  leafLength: number;
  dataOffset: number;
  dataLength: number;
  addressed: number;
  entries: number;
  contents: number;
  clustered: boolean;
  internalCompression: number;
  tileCompression: number;
  tileType: number;
  minZoom: number;
  maxZoom: number;
  boundsE7: [number, number, number, number];
  centerZoom: number;
  centerE7: [number, number];
};
export type PmtilesEntry = { tileId: number; offset: number; length: number; runLength: number };
export type PmtilesArchive = { header: PmtilesHeader; metadata: Record<string, unknown>; entries: PmtilesEntry[]; size: number; read(entry: PmtilesEntry): Buffer; close(): void };
export type TileSetInfo = Pick<PmtilesHeader, 'tileCompression' | 'tileType' | 'minZoom' | 'maxZoom' | 'boundsE7' | 'centerZoom' | 'centerE7'>;
export type WriteResult = { bytes: number; addressed: number; entries: number; contents: number };

export const HEADER_LENGTH = 127;
const ROOT_LIMIT = 16384 - HEADER_LENGTH;
const GZIP = 2;

export const GZIP_LEVEL = 9;

export function gzipStable(bytes: Uint8Array): Buffer {
  const out = gzipSync(bytes, { level: GZIP_LEVEL });
  out[9] = 255;
  return out;
}

function readVarint(bytes: Uint8Array, at: number): [number, number] {
  let value = 0;
  let factor = 1;
  for (let pos = at; ; pos++) {
    if (pos >= bytes.length) throw new Error('pmtiles: dizin yarıda kesildi');
    const byte = bytes[pos] as number;
    value += (byte % 128) * factor;
    if (byte < 128) return [value, pos + 1];
    factor *= 128;
  }
}

function pushVarint(out: number[], value: number): void {
  let rest = value;
  while (rest >= 128) {
    out.push((rest % 128) + 128);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
}

export function parseDirectory(bytes: Uint8Array): PmtilesEntry[] {
  const [count, start] = readVarint(bytes, 0);
  let at = start;
  const entries: PmtilesEntry[] = Array.from({ length: count }, () => ({ tileId: 0, offset: 0, length: 0, runLength: 0 }));
  let last = 0;
  for (const entry of entries) {
    let delta: number;
    [delta, at] = readVarint(bytes, at);
    last += delta;
    entry.tileId = last;
  }
  for (const entry of entries) [entry.runLength, at] = readVarint(bytes, at);
  for (const entry of entries) [entry.length, at] = readVarint(bytes, at);
  entries.forEach((entry, i) => {
    let value: number;
    [value, at] = readVarint(bytes, at);
    const previous = entries[i - 1];
    entry.offset = value === 0 && previous ? previous.offset + previous.length : value - 1;
  });
  return entries;
}

export function serializeDirectory(entries: PmtilesEntry[]): Buffer {
  const out: number[] = [];
  pushVarint(out, entries.length);
  let last = 0;
  for (const entry of entries) {
    pushVarint(out, entry.tileId - last);
    last = entry.tileId;
  }
  for (const entry of entries) pushVarint(out, entry.runLength);
  for (const entry of entries) pushVarint(out, entry.length);
  entries.forEach((entry, i) => {
    const previous = entries[i - 1];
    pushVarint(out, i > 0 && previous && entry.offset === previous.offset + previous.length ? 0 : entry.offset + 1);
  });
  return gzipStable(Uint8Array.from(out));
}

function readHeader(bytes: Buffer, path: string): PmtilesHeader {
  if (bytes.length < HEADER_LENGTH || bytes.toString('latin1', 0, 7) !== 'PMTiles' || bytes[7] !== 3) throw new Error(`${path}: PMTiles v3 değil`);
  const u64 = (at: number): number => Number(bytes.readBigUInt64LE(at));
  return {
    rootOffset: u64(8),
    rootLength: u64(16),
    metadataOffset: u64(24),
    metadataLength: u64(32),
    leafOffset: u64(40),
    leafLength: u64(48),
    dataOffset: u64(56),
    dataLength: u64(64),
    addressed: u64(72),
    entries: u64(80),
    contents: u64(88),
    clustered: bytes[96] === 1,
    internalCompression: bytes[97] as number,
    tileCompression: bytes[98] as number,
    tileType: bytes[99] as number,
    minZoom: bytes[100] as number,
    maxZoom: bytes[101] as number,
    boundsE7: [bytes.readInt32LE(102), bytes.readInt32LE(106), bytes.readInt32LE(110), bytes.readInt32LE(114)],
    centerZoom: bytes[118] as number,
    centerE7: [bytes.readInt32LE(119), bytes.readInt32LE(123)],
  };
}

function writeHeader(header: PmtilesHeader): Buffer {
  const out = Buffer.alloc(HEADER_LENGTH);
  out.write('PMTiles', 0, 'latin1');
  out[7] = 3;
  const u64 = (at: number, value: number): void => void out.writeBigUInt64LE(BigInt(value), at);
  u64(8, header.rootOffset);
  u64(16, header.rootLength);
  u64(24, header.metadataOffset);
  u64(32, header.metadataLength);
  u64(40, header.leafOffset);
  u64(48, header.leafLength);
  u64(56, header.dataOffset);
  u64(64, header.dataLength);
  u64(72, header.addressed);
  u64(80, header.entries);
  u64(88, header.contents);
  out[96] = header.clustered ? 1 : 0;
  out[97] = header.internalCompression;
  out[98] = header.tileCompression;
  out[99] = header.tileType;
  out[100] = header.minZoom;
  out[101] = header.maxZoom;
  header.boundsE7.forEach((value, i) => out.writeInt32LE(value, 102 + i * 4));
  out[118] = header.centerZoom;
  out.writeInt32LE(header.centerE7[0], 119);
  out.writeInt32LE(header.centerE7[1], 123);
  return out;
}

export function openPmtiles(path: string): PmtilesArchive {
  const fd = openSync(path, 'r');
  try {
    const read = (offset: number, length: number): Buffer => {
      const out = Buffer.alloc(length);
      if (readSync(fd, out, 0, length, offset) !== length) throw new Error(`${path}: dosya beklenenden kısa`);
      return out;
    };
    const header = readHeader(read(0, HEADER_LENGTH), path);
    const inner = (bytes: Buffer): Buffer => {
      if (header.internalCompression === GZIP) return gunzipSync(bytes);
      if (header.internalCompression === 1) return bytes;
      throw new Error(`${path}: desteklenmeyen dizin sıkıştırması ${header.internalCompression}`);
    };
    const entries: PmtilesEntry[] = [];
    const walk = (directory: Buffer, depth: number): void => {
      if (depth > 3) throw new Error(`${path}: dizin derinliği çok fazla`);
      for (const entry of parseDirectory(directory)) {
        if (entry.runLength === 0) walk(inner(read(header.leafOffset + entry.offset, entry.length)), depth + 1);
        else entries.push(entry);
      }
    };
    walk(inner(read(header.rootOffset, header.rootLength)), 0);
    const metadata = header.metadataLength > 0 ? (JSON.parse(inner(read(header.metadataOffset, header.metadataLength)).toString('utf8')) as Record<string, unknown>) : {};
    return {
      header,
      metadata,
      entries,
      size: fstatSync(fd).size,
      read: (entry) => read(header.dataOffset + entry.offset, entry.length),
      close: () => closeSync(fd),
    };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

export function zoomOfTileId(tileId: number): number {
  let first = 0;
  for (let z = 0; z < 32; z++) {
    const count = 4 ** z;
    if (tileId < first + count) return z;
    first += count;
  }
  throw new Error(`geçersiz karo kimliği ${tileId}`);
}

export function firstTileId(z: number): number {
  return (4 ** z - 1) / 3;
}

function rotate(n: number, xy: [number, number], rx: number, ry: number): void {
  if (ry !== 0) return;
  if (rx === 1) {
    xy[0] = n - 1 - xy[0];
    xy[1] = n - 1 - xy[1];
  }
  const t = xy[0];
  xy[0] = xy[1];
  xy[1] = t;
}

export function tileIdOf(z: number, x: number, y: number): number {
  const n = 2 ** z;
  const xy: [number, number] = [x, y];
  let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = xy[0] & s ? 1 : 0;
    const ry = xy[1] & s ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    rotate(s, xy, rx, ry);
  }
  return firstTileId(z) + d;
}

export function zxyOf(tileId: number): [number, number, number] {
  const z = zoomOfTileId(tileId);
  const n = 2 ** z;
  let t = tileId - firstTileId(z);
  const xy: [number, number] = [0, 0];
  for (let s = 1; s < n; s *= 2) {
    const rx = Math.floor(t / 2) % 2;
    const ry = (t % 2) ^ rx;
    rotate(s, xy, rx, ry);
    xy[0] += s * rx;
    xy[1] += s * ry;
    t = Math.floor(t / 4);
  }
  return [z, xy[0], xy[1]];
}

function directories(entries: PmtilesEntry[]): { root: Buffer; leaves: Buffer } {
  if (entries.length < 16384) {
    const root = serializeDirectory(entries);
    if (root.length <= ROOT_LIMIT) return { root, leaves: Buffer.alloc(0) };
  }
  for (let leafSize = Math.max(4096, entries.length / 3500); ; leafSize *= 1.2) {
    const size = Math.floor(leafSize);
    const rootEntries: PmtilesEntry[] = [];
    const parts: Buffer[] = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += size) {
      const leaf = serializeDirectory(entries.slice(i, i + size));
      rootEntries.push({ tileId: (entries[i] as PmtilesEntry).tileId, offset, length: leaf.length, runLength: 0 });
      parts.push(leaf);
      offset += leaf.length;
    }
    const root = serializeDirectory(rootEntries);
    if (root.length <= ROOT_LIMIT) return { root, leaves: Buffer.concat(parts) };
  }
}

export function writePmtiles(path: string, info: TileSetInfo, metadata: Record<string, unknown>, tiles: Iterable<{ tileId: number; data: Uint8Array }>): WriteResult {
  const entries: PmtilesEntry[] = [];
  const blobs: Uint8Array[] = [];
  const known = new Map<string, { offset: number; length: number }>();
  let dataLength = 0;
  let addressed = 0;
  let previous = -1;
  for (const tile of tiles) {
    if (tile.tileId <= previous) throw new Error(`karolar artan sırada değil (${tile.tileId})`);
    previous = tile.tileId;
    addressed += 1;
    const hash = createHash('sha256').update(tile.data).digest('hex');
    let place = known.get(hash);
    if (!place) {
      place = { offset: dataLength, length: tile.data.length };
      known.set(hash, place);
      blobs.push(tile.data);
      dataLength += tile.data.length;
    }
    const last = entries[entries.length - 1];
    if (last && last.offset === place.offset && last.length === place.length && last.tileId + last.runLength === tile.tileId) last.runLength += 1;
    else entries.push({ tileId: tile.tileId, offset: place.offset, length: place.length, runLength: 1 });
  }
  const { root, leaves } = directories(entries);
  const meta = gzipStable(Buffer.from(JSON.stringify(metadata), 'utf8'));
  const header: PmtilesHeader = {
    ...info,
    rootOffset: HEADER_LENGTH,
    rootLength: root.length,
    metadataOffset: HEADER_LENGTH + root.length,
    metadataLength: meta.length,
    leafOffset: HEADER_LENGTH + root.length + meta.length,
    leafLength: leaves.length,
    dataOffset: HEADER_LENGTH + root.length + meta.length + leaves.length,
    dataLength,
    addressed,
    entries: entries.length,
    contents: blobs.length,
    clustered: true,
    internalCompression: GZIP,
  };
  const temporary = `${path}.tmp`;
  const fd = openSync(temporary, 'w');
  try {
    for (const part of [writeHeader(header), root, meta, leaves, ...blobs]) {
      for (let done = 0; done < part.length; ) done += writeSync(fd, part, done, part.length - done);
    }
  } catch (error) {
    closeSync(fd);
    rmSync(temporary, { force: true });
    throw error;
  }
  closeSync(fd);
  renameSync(temporary, path);
  return { bytes: header.dataOffset + dataLength, addressed, entries: entries.length, contents: blobs.length };
}

export function rewritePmtiles(source: string, target: string): WriteResult {
  const archive = openPmtiles(source);
  try {
    const { header } = archive;
    const tiles: { tileId: number; data: Uint8Array }[] = [];
    for (const entry of archive.entries) {
      const data = archive.read(entry);
      for (let i = 0; i < entry.runLength; i++) tiles.push({ tileId: entry.tileId + i, data });
    }
    return writePmtiles(target, { tileCompression: header.tileCompression, tileType: header.tileType, minZoom: header.minZoom, maxZoom: header.maxZoom, boundsE7: header.boundsE7, centerZoom: header.centerZoom, centerE7: header.centerE7 }, archive.metadata, tiles);
  } finally {
    archive.close();
  }
}
