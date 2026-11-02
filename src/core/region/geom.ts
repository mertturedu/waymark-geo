export type Point = [number, number];
export type Ring = Point[];
export type Polygon = Ring[];

const VERSION = 1;
const DEFAULT_SCALE = 1e6;

export type Writer = { bytes: number[]; varint(value: number): void; signed(value: number): void };

export function createWriter(): Writer {
  const bytes: number[] = [];
  const varint = (value: number): void => {
    let rest = value;
    while (rest >= 128) {
      bytes.push((rest % 128) + 128);
      rest = Math.floor(rest / 128);
    }
    bytes.push(rest);
  };
  return { bytes, varint, signed: (value) => varint(value >= 0 ? value * 2 : -value * 2 - 1) };
}

export type Reader = { byte(): number; varint(): number; signed(): number; done(): void };

export function createReader(bytes: Uint8Array): Reader {
  let at = 0;
  const byte = (): number => {
    if (at >= bytes.length) throw new Error('geometry bytes end too early');
    const value = bytes[at] as number;
    at += 1;
    return value;
  };
  const varint = (): number => {
    let value = 0;
    let factor = 1;
    for (;;) {
      const next = byte();
      value += (next % 128) * factor;
      if (next < 128) return value;
      factor *= 128;
    }
  };
  return {
    byte,
    varint,
    signed: () => {
      const raw = varint();
      return raw % 2 === 0 ? raw / 2 : -(raw + 1) / 2;
    },
    done: () => {
      if (at !== bytes.length) throw new Error('geometry bytes have trailing data');
    },
  };
}

function writePoints(writer: Writer, points: Ring, scale: number): void {
  writer.varint(points.length);
  let x = 0;
  let y = 0;
  for (const point of points) {
    const nx = Math.round(point[0] * scale);
    const ny = Math.round(point[1] * scale);
    writer.signed(nx - x);
    writer.signed(ny - y);
    x = nx;
    y = ny;
  }
}

function readPoints(reader: Reader, scale: number): Ring {
  const count = reader.varint();
  const points: Ring = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < count; i++) {
    x += reader.signed();
    y += reader.signed();
    points.push([x / scale, y / scale]);
  }
  return points;
}

function header(reader: Reader, kind: number): number {
  const version = reader.byte();
  if (version !== VERSION) throw new Error(`unknown geometry version ${version}`);
  if (reader.byte() !== kind) throw new Error('geometry kind does not match');
  const scale = reader.varint();
  if (scale === 0) throw new Error('geometry scale is zero');
  return scale;
}

export function encodeRings(polygons: Polygon[], scale: number = DEFAULT_SCALE): Uint8Array {
  const writer = createWriter();
  writer.bytes.push(VERSION, 0);
  writer.varint(scale);
  writer.varint(polygons.length);
  for (const polygon of polygons) {
    writer.varint(polygon.length);
    for (const ring of polygon) writePoints(writer, ring, scale);
  }
  return Uint8Array.from(writer.bytes);
}

export function decodeRings(bytes: Uint8Array): Polygon[] {
  const reader = createReader(bytes);
  const scale = header(reader, 0);
  const polygons: Polygon[] = [];
  const count = reader.varint();
  for (let i = 0; i < count; i++) {
    const rings: Polygon = [];
    const ringCount = reader.varint();
    for (let j = 0; j < ringCount; j++) rings.push(readPoints(reader, scale));
    polygons.push(rings);
  }
  reader.done();
  return polygons;
}

export function encodeLine(line: Ring, scale: number = DEFAULT_SCALE): Uint8Array {
  const writer = createWriter();
  writer.bytes.push(VERSION, 1);
  writer.varint(scale);
  writePoints(writer, line, scale);
  return Uint8Array.from(writer.bytes);
}

export function decodeLine(bytes: Uint8Array): Ring {
  const reader = createReader(bytes);
  const scale = header(reader, 1);
  const line = readPoints(reader, scale);
  reader.done();
  return line;
}

export function encodeLines(lines: Ring[], scale: number = DEFAULT_SCALE): Uint8Array {
  const writer = createWriter();
  writer.bytes.push(VERSION, 2);
  writer.varint(scale);
  writer.varint(lines.length);
  for (const line of lines) writePoints(writer, line, scale);
  return Uint8Array.from(writer.bytes);
}

export function decodeLines(bytes: Uint8Array): Ring[] {
  const reader = createReader(bytes);
  const scale = header(reader, 2);
  const lines: Ring[] = [];
  const count = reader.varint();
  for (let i = 0; i < count; i++) lines.push(readPoints(reader, scale));
  reader.done();
  return lines;
}

function onSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (cross !== 0) return false;
  return p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}

function ringSide(p: Point, ring: Ring): 'in' | 'out' | 'edge' {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i] as Point;
    const b = ring[j] as Point;
    if (onSegment(p, a, b)) return 'edge';
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? 'in' : 'out';
}

export function pointInRings(point: Point, polygons: Polygon[]): boolean {
  for (const polygon of polygons) {
    const outer = polygon[0];
    if (!outer) continue;
    if (ringSide(point, outer) === 'out') continue;
    let inHole = false;
    for (let h = 1; h < polygon.length; h++) if (ringSide(point, polygon[h] as Ring) === 'in') inHole = true;
    if (!inHole) return true;
  }
  return false;
}
