import { cursorOf, packError } from './bytes';
import { ORIGINAL, type Hierarchy } from './hierarchy';

export const MAGIC = 0x54524759;
export const VERSION = 1;
export const SECTION = { nodes: 1, edges: 2, shapes: 3, up: 4, down: 5, entry: 6, exits: 7, grid: 8 } as const;

export const FLAG = { forward: 1, backward: 2, main: 4, penaltyForward: 8, penaltyBackward: 16, classShift: 5 } as const;

export type Edges = {
  count: number;
  tail: Uint32Array;
  head: Uint32Array;
  flags: Uint16Array;
  length: Uint32Array;
  travel: Uint32Array;
  shapeOffset: Uint32Array;
  shapes: Uint8Array;
};

export type Pairs = { key: Uint32Array; node: Uint32Array };

export type Grid = { originLon: number; originLat: number; cell: number; cols: number; rows: number; first: Uint32Array; edges: Uint32Array };

export type RoutePack = {
  bbox: [number, number, number, number];
  hierarchy: Hierarchy;
  base: { count: number; lon: Int32Array; lat: Int32Array; node: Uint32Array };
  edges: Edges;
  entry: Pairs;
  exits: Pairs;
  grid: Grid;
};

const HEADER_BYTES = 44;
const TABLE_ENTRY = 9;
const MAX_NODES = 1 << 26;

type Table = Map<number, [number, number]>;

function readTable(buf: Uint8Array, view: DataView): Table {
  if (buf.length < HEADER_BYTES) throw packError('too short');
  if (view.getUint32(0, true) !== MAGIC) throw packError('not a route pack');
  if (view.getUint16(4, true) !== VERSION) throw packError('unknown version');
  const sections = view.getUint32(40, true);
  if (sections > 32 || HEADER_BYTES + sections * TABLE_ENTRY > buf.length) throw packError('bad section table');
  const table: Table = new Map();
  for (let i = 0; i < sections; i++) {
    const at = HEADER_BYTES + i * TABLE_ENTRY;
    const offset = view.getUint32(at + 1, true);
    const length = view.getUint32(at + 5, true);
    if (offset + length > buf.length) throw packError('section out of range');
    table.set(view.getUint8(at), [offset, offset + length]);
  }
  return table;
}

function section(table: Table, id: number): [number, number] {
  const found = table.get(id);
  if (!found) throw packError(`missing section ${id}`);
  return found;
}

function readHierarchy(buf: Uint8Array, table: Table, n: number): Hierarchy {
  const read = (id: number): { first: Uint32Array; other: Uint32Array; w: Uint32Array; len: Uint32Array; via: Uint32Array } => {
    const [start, end] = section(table, id);
    const c = cursorOf(buf, start, end);
    const total = c.u();
    if (total > end - start) throw packError('entry count');
    const first = new Uint32Array(n + 1);
    const other = new Uint32Array(total);
    const w = new Uint32Array(total);
    const len = new Uint32Array(total);
    const via = new Uint32Array(total);
    let at = 0;
    for (let v = 0; v < n; v++) {
      const count = c.u();
      if (at + count > total) throw packError('entry overflow');
      let previous = v;
      for (let k = 0; k < count; k++) {
        previous += c.u() + (k === 0 ? 1 : 0);
        if (previous >= n) throw packError('node out of range');
        other[at] = previous;
        w[at] = c.u();
        len[at] = c.u();
        const raw = c.u();
        const isOriginal = raw % 2 === 1;
        const value = (raw - (isOriginal ? 1 : 0)) / 2;
        if (!isOriginal && value >= v) throw packError('shortcut middle');
        via[at] = isOriginal ? (ORIGINAL + value) >>> 0 : value;
        at++;
      }
      first[v + 1] = at;
    }
    if (at !== total) throw packError('entry count mismatch');
    return { first, other, w, len, via };
  };
  const up = read(SECTION.up);
  const down = read(SECTION.down);
  return {
    n,
    upFirst: up.first,
    upTo: up.other,
    upW: up.w,
    upLen: up.len,
    upVia: up.via,
    downFirst: down.first,
    downFrom: down.other,
    downW: down.w,
    downLen: down.len,
    downVia: down.via,
  };
}

function readPairs(buf: Uint8Array, table: Table, id: number, nodes: number): Pairs {
  const [start, end] = section(table, id);
  const c = cursorOf(buf, start, end);
  const count = c.u();
  if (count > end - start) throw packError('pair count');
  const key = new Uint32Array(count);
  const node = new Uint32Array(count);
  let previous = 0;
  for (let i = 0; i < count; i++) {
    previous += c.u();
    key[i] = previous;
    const v = c.u();
    if (v >= nodes) throw packError('pair node');
    node[i] = v;
  }
  return { key, node };
}

export function readRoutePack(buf: Uint8Array): RoutePack {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const table = readTable(buf, view);
  const nodeCount = view.getUint32(8, true);
  const baseCount = view.getUint32(12, true);
  const edgeCount = view.getUint32(16, true);
  if (nodeCount > MAX_NODES || baseCount > MAX_NODES || edgeCount > MAX_NODES || Math.max(nodeCount, baseCount, edgeCount) > buf.length) throw packError('size');
  const bbox: [number, number, number, number] = [view.getInt32(20, true), view.getInt32(24, true), view.getInt32(28, true), view.getInt32(32, true)];

  const [nodesStart, nodesEnd] = section(table, SECTION.nodes);
  const nodes = cursorOf(buf, nodesStart, nodesEnd);
  const lon = new Int32Array(baseCount);
  const lat = new Int32Array(baseCount);
  const hid = new Uint32Array(baseCount);
  let x = 0;
  let y = 0;
  for (let i = 0; i < baseCount; i++) {
    x += nodes.z();
    y += nodes.z();
    lon[i] = x;
    lat[i] = y;
    const node = nodes.u();
    if (node >= nodeCount) throw packError('base node');
    hid[i] = node;
  }

  const [edgesStart, edgesEnd] = section(table, SECTION.edges);
  const e = cursorOf(buf, edgesStart, edgesEnd);
  const tail = new Uint32Array(edgeCount);
  const head = new Uint32Array(edgeCount);
  const flags = new Uint16Array(edgeCount);
  const length = new Uint32Array(edgeCount);
  const travel = new Uint32Array(edgeCount * 2);
  const shapeOffset = new Uint32Array(edgeCount + 1);
  let previousTail = 0;
  for (let i = 0; i < edgeCount; i++) {
    previousTail += e.z();
    const t = previousTail;
    const h = t + e.z();
    if (t < 0 || t >= baseCount || h < 0 || h >= baseCount) throw packError('edge node');
    tail[i] = t;
    head[i] = h;
    const f = e.u();
    if (f > 0xffff) throw packError('edge flags');
    flags[i] = f;
    length[i] = e.u();
    travel[2 * i] = e.u();
    travel[2 * i + 1] = e.u();
    shapeOffset[i + 1] = (shapeOffset[i] as number) + e.u();
  }
  const [shapesStart, shapesEnd] = section(table, SECTION.shapes);
  if (shapeOffset[edgeCount] !== shapesEnd - shapesStart) throw packError('shape size');

  const [gridStart, gridEnd] = section(table, SECTION.grid);
  const g = cursorOf(buf, gridStart, gridEnd);
  const originLon = g.z();
  const originLat = g.z();
  const cell = g.u();
  const cols = g.u();
  const rows = g.u();
  if (cell === 0 || cols * rows > MAX_NODES || cols * rows > gridEnd - gridStart) throw packError('grid size');
  const first = new Uint32Array(cols * rows + 1);
  let total = 0;
  for (let i = 0; i < cols * rows; i++) {
    total += g.u();
    if (total > gridEnd - gridStart) throw packError('grid edge');
    first[i + 1] = total;
  }
  const members = new Uint32Array(total);
  for (let i = 0; i < cols * rows; i++) {
    let previous = 0;
    for (let k = first[i] as number; k < (first[i + 1] as number); k++) {
      previous += g.u();
      if (previous >= edgeCount) throw packError('grid edge');
      members[k] = previous;
    }
  }

  return {
    bbox,
    hierarchy: readHierarchy(buf, table, nodeCount),
    base: { count: baseCount, lon, lat, node: hid },
    edges: { count: edgeCount, tail, head, flags, length, travel, shapeOffset, shapes: buf.slice(shapesStart, shapesEnd) },
    entry: readPairs(buf, table, SECTION.entry, nodeCount),
    exits: readPairs(buf, table, SECTION.exits, nodeCount),
    grid: { originLon, originLat, cell, cols, rows, first, edges: members },
  };
}

export function edgeLine(pack: RoutePack, edge: number): number[] {
  const { edges, base } = pack;
  const c = cursorOf(edges.shapes, edges.shapeOffset[edge] as number, edges.shapeOffset[edge + 1] as number);
  const out: number[] = [base.lon[edges.tail[edge] as number] as number, base.lat[edges.tail[edge] as number] as number];
  const count = c.u();
  let x = out[0] as number;
  let y = out[1] as number;
  for (let i = 0; i < count; i++) {
    x += c.z();
    y += c.z();
    out.push(x, y);
  }
  out.push(base.lon[edges.head[edge] as number] as number, base.lat[edges.head[edge] as number] as number);
  return out;
}
