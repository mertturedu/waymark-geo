import { decodeLayer, decodeTile, decodeValue, encodeLayer, encodeTile, type MvtFeature, type MvtLayer } from './mvt';
import { zxyOf } from './pmtiles-file';

export type Pt = [number, number];
export type CellPiece = { cell: string; line: Pt[] };

const LNG_STEP = 360 / 32768;
const LAT_STEP = 180 / 32768;
const ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';
const LINESTRING = 2;
export const CELL_KEY = 'cell';
export const SPLIT_KINDS = new Set(['highway', 'major_road', 'medium_road', 'minor_road']);
export const SPLIT_FROM_ZOOM = 9;

const utf8 = new TextEncoder();

export function cellName(col: number, row: number): string {
  let out = '';
  for (let group = 0; group < 6; group++) {
    let value = 0;
    for (let bit = 0; bit < 5; bit++) {
      const k = group * 5 + bit;
      const source = k % 2 === 0 ? col : row;
      const index = 14 - (k >> 1);
      value = (value << 1) | ((source >> index) & 1);
    }
    out += ALPHABET[value];
  }
  return out;
}

export function decodeLines(bytes: Uint8Array): Pt[][] {
  const lines: Pt[][] = [];
  let at = 0;
  let x = 0;
  let y = 0;
  let current: Pt[] = [];
  const next = (): number => {
    let value = 0;
    let factor = 1;
    for (;;) {
      const byte = bytes[at++] as number;
      value += (byte % 128) * factor;
      if (byte < 128) return value;
      factor *= 128;
    }
  };
  while (at < bytes.length) {
    const head = next();
    const command = head % 8;
    const count = Math.floor(head / 8);
    for (let i = 0; i < count; i++) {
      if (command === 7) continue;
      const dx = next();
      const dy = next();
      x += dx % 2 === 0 ? dx / 2 : -(dx + 1) / 2;
      y += dy % 2 === 0 ? dy / 2 : -(dy + 1) / 2;
      if (command === 1) {
        if (current.length > 0) lines.push(current);
        current = [[x, y]];
      } else current.push([x, y]);
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

export function encodeLines(lines: Pt[][]): Uint8Array {
  const out: number[] = [];
  const zigzag = (v: number): number => (v < 0 ? -2 * v - 1 : 2 * v);
  const push = (value: number): void => {
    let rest = value;
    while (rest >= 128) {
      out.push((rest % 128) + 128);
      rest = Math.floor(rest / 128);
    }
    out.push(rest);
  };
  let x = 0;
  let y = 0;
  for (const line of lines) {
    const [first, ...rest] = line as [Pt, ...Pt[]];
    push(1 | (1 << 3));
    push(zigzag(first[0] - x));
    push(zigzag(first[1] - y));
    x = first[0];
    y = first[1];
    push(2 | (rest.length << 3));
    for (const [px, py] of rest) {
      push(zigzag(px - x));
      push(zigzag(py - y));
      x = px;
      y = py;
    }
  }
  return Uint8Array.from(out);
}

export function splitByCell(lines: Pt[][], z: number, tx: number, ty: number, extent: number): CellPiece[] {
  const n = 2 ** z;
  const colOf = (px: number): number => Math.floor((((tx + px / extent) / n) * 360) / LNG_STEP);
  const latOf = (py: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + py / extent)) / n))) * 180) / Math.PI;
  const rowOf = (py: number): number => Math.floor((latOf(py) + 90) / LAT_STEP);
  const colEdge = (col: number): number => (((col * LNG_STEP) / 360) * n - tx) * extent;
  const rowEdge = (row: number): number => {
    const lat = (-90 + row * LAT_STEP) * (Math.PI / 180);
    return (((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n - ty) * extent;
  };
  const pieces: CellPiece[] = [];
  for (const line of lines) {
    let cell = '';
    let current: Pt[] = [];
    const close = (): void => {
      if (current.length > 1) pieces.push({ cell, line: current });
      current = [];
    };
    for (let i = 1; i < line.length; i++) {
      const [x0, y0] = line[i - 1] as Pt;
      const [x1, y1] = line[i] as Pt;
      const ts = [0, 1];
      const c0 = colOf(x0);
      const c1 = colOf(x1);
      if (x1 !== x0) for (let c = Math.min(c0, c1) + 1; c <= Math.max(c0, c1); c++) ts.push((colEdge(c) - x0) / (x1 - x0));
      const r0 = rowOf(y0);
      const r1 = rowOf(y1);
      if (y1 !== y0) for (let r = Math.min(r0, r1) + 1; r <= Math.max(r0, r1); r++) ts.push((rowEdge(r) - y0) / (y1 - y0));
      const sorted = ts.filter((t) => t >= 0 && t <= 1).sort((a, b) => a - b);
      for (let k = 1; k < sorted.length; k++) {
        const ta = sorted[k - 1] as number;
        const tb = sorted[k] as number;
        if (tb - ta < 1e-9) continue;
        const mid = (ta + tb) / 2;
        const name = cellName(colOf(x0 + (x1 - x0) * mid), rowOf(y0 + (y1 - y0) * mid));
        const a: Pt = [Math.round(x0 + (x1 - x0) * ta), Math.round(y0 + (y1 - y0) * ta)];
        const b: Pt = [Math.round(x0 + (x1 - x0) * tb), Math.round(y0 + (y1 - y0) * tb)];
        if (name !== cell) {
          close();
          cell = name;
        }
        const last = current[current.length - 1];
        if (!last) current.push(a);
        else if (last[0] !== a[0] || last[1] !== a[1]) current.push(a);
        if (a[0] !== b[0] || a[1] !== b[1]) current.push(b);
      }
    }
    close();
  }
  return pieces;
}

function stringValue(text: string): Uint8Array {
  const body = utf8.encode(text);
  return Uint8Array.from([0x0a, body.length, ...body]);
}

export function splitRoadLayer(layer: MvtLayer, z: number, tx: number, ty: number): { layer: MvtLayer; split: number } {
  if (layer.keys.includes(CELL_KEY)) return { layer, split: 0 };
  const kindKey = layer.keys.indexOf('kind');
  if (kindKey < 0) return { layer, split: 0 };
  const keys = [...layer.keys, CELL_KEY];
  const cellKey = keys.length - 1;
  const values = [...layer.values];
  const known = new Map<string, number>();
  const kindOf = new Map<number, string>();
  const features: MvtFeature[] = [];
  let split = 0;
  for (const feature of layer.features) {
    let kind = '';
    for (let i = 0; i < feature.tags.length; i += 2) {
      if (feature.tags[i] !== kindKey) continue;
      const index = feature.tags[i + 1] as number;
      if (!kindOf.has(index)) kindOf.set(index, String(decodeValue(layer.values[index] as Uint8Array)));
      kind = kindOf.get(index) as string;
    }
    if (feature.type !== LINESTRING || feature.geometry === null || !SPLIT_KINDS.has(kind)) {
      features.push(feature);
      continue;
    }
    for (const piece of splitByCell(decodeLines(feature.geometry), z, tx, ty, layer.extent)) {
      let index = known.get(piece.cell);
      if (index === undefined) {
        index = values.length;
        values.push(stringValue(piece.cell));
        known.set(piece.cell, index);
      }
      features.push({ ...feature, tags: [...feature.tags, cellKey, index], geometry: encodeLines([piece.line]) });
      split += 1;
    }
  }
  return { layer: { ...layer, keys, values, features }, split };
}

export function splitRoadsInTile(tile: Uint8Array, tileId: number): { data: Uint8Array; split: number } | null {
  const [z, x, y] = zxyOf(tileId);
  if (z < SPLIT_FROM_ZOOM) return null;
  const { layers, foreign } = decodeTile(tile);
  if (foreign > 0) return null;
  let split = 0;
  const out = layers.map((bytes) => {
    const layer = decodeLayer(bytes);
    if (!layer || layer.name !== 'roads') return bytes;
    const result = splitRoadLayer(layer, z, x, y);
    split += result.split;
    return result.split === 0 ? bytes : encodeLayer(result.layer);
  });
  return split === 0 ? null : { data: encodeTile(out), split };
}
