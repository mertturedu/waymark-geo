import { closeSync, openSync, readSync } from 'node:fs';
import { SDK_VERSION } from '../../src/core/create-geo';
import { compareVersions } from '../../src/core/packs/verify';
import { FLAG, MAGIC, MIRROR_VERSION, SECTION, VERSION, mirrorVia, readRoutePack } from '../../src/core/route/format';
import { ORIGINAL, VIA_MASK, type Hierarchy } from '../../src/core/route/hierarchy';
import { buildCsr } from '../../src/core/route/plain';
import { contract } from './route-ch';
import { buildBaseGraph, type GraphOptions, type RoadRows } from './route-graph';
import { largestComponent } from './route-scc';
import { applyRestrictions, type RoadGraph } from './route-turns';

export type PackReport = {
  baseNodes: number;
  edges: number;
  graphNodes: number;
  copies: number;
  rules: { total: number; applied: number; skipped: Record<string, number> };
  arcs: number;
  shortcuts: number;
  options: { ferries: boolean; minComponent: number; plate?: string };
  mainShare: number;
  dropped: { nodes: number; edges: number; scraps: number };
  gridCells: number;
  bytes: number;
  sections: Record<string, number>;
};

const CELL_MICRO = 5000;

export type RouteFormat = typeof VERSION | typeof MIRROR_VERSION;
export const ROUTE_MIN_SDK: Record<RouteFormat, string> = { [VERSION]: '0.3.0', [MIRROR_VERSION]: '0.6.0' };

export function routeFormat(sdk: string = SDK_VERSION, wanted: string | undefined = process.env.GEO_ROUTE_FORMAT): RouteFormat {
  if (wanted === String(VERSION) || wanted === String(MIRROR_VERSION)) return Number(wanted) as RouteFormat;
  if (wanted !== undefined && wanted !== '') throw new Error(`GEO_ROUTE_FORMAT 1 ya da 2 olmalı: ${wanted}`);
  return compareVersions(sdk, ROUTE_MIN_SDK[MIRROR_VERSION]) >= 0 ? MIRROR_VERSION : VERSION;
}

export function routeMinSdk(paths: string[]): string {
  let need = ROUTE_MIN_SDK[VERSION];
  for (const path of paths) {
    const head = Buffer.alloc(6);
    const fd = openSync(path, 'r');
    try {
      readSync(fd, head, 0, 6, 0);
    } finally {
      closeSync(fd);
    }
    const sdk = ROUTE_MIN_SDK[head.readUInt16LE(4) as RouteFormat];
    if (!sdk) throw new Error(`${path}: bilinmeyen rota paketi sürümü ${head.readUInt16LE(4)}`);
    if (compareVersions(sdk, need) > 0) need = sdk;
  }
  return need;
}

export function mirrorFlags(h: Hierarchy): { up: Uint8Array; down: Uint8Array } {
  const up = new Uint8Array(h.upTo.length);
  const down = new Uint8Array(h.downFrom.length);
  for (let v = 0; v < h.n; v++) {
    const single = new Map<number, number>();
    const twice = new Set<number>();
    for (let k = h.downFirst[v] as number; k < (h.downFirst[v + 1] as number); k++) {
      const from = h.downFrom[k] as number;
      if (single.has(from)) twice.add(from);
      else single.set(from, k);
    }
    for (let i = h.upFirst[v] as number; i < (h.upFirst[v + 1] as number); i++) {
      const to = h.upTo[i] as number;
      const k = single.get(to);
      if (k === undefined || twice.has(to) || down[k] === 1) continue;
      if (h.downW[k] === h.upW[i] && h.downLen[k] === h.upLen[i] && h.downVia[k] === mirrorVia(h.upVia[i] as number)) {
        up[i] = 1;
        down[k] = 1;
      }
    }
  }
  return { up, down };
}

type Writer = { u(v: number): void; z(v: number): void; byte(v: number): void; u32(v: number): void; i32(v: number): void; length(): number; bytes(): Uint8Array };

function createWriter(): Writer {
  let buf = new Uint8Array(1 << 16);
  let size = 0;
  const room = (extra: number): void => {
    if (size + extra <= buf.length) return;
    const next = new Uint8Array(Math.max(buf.length * 2, size + extra));
    next.set(buf.subarray(0, size));
    buf = next;
  };
  const u = (value: number): void => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`rota paketi: ${value} yazılamaz`);
    room(5);
    let v = value;
    while (v >= 128) {
      buf[size++] = (v % 128) + 128;
      v = Math.floor(v / 128);
    }
    buf[size++] = v;
  };
  return {
    u,
    z: (v) => u(v >= 0 ? v * 2 : -v * 2 - 1),
    byte(v) {
      room(1);
      buf[size++] = v;
    },
    u32(v) {
      room(4);
      new DataView(buf.buffer).setUint32(size, v, true);
      size += 4;
    },
    i32(v) {
      room(4);
      new DataView(buf.buffer).setInt32(size, v, true);
      size += 4;
    },
    length: () => size,
    bytes: () => buf.slice(0, size),
  };
}

function cellsOfSegment(x0: number, y0: number, x1: number, y1: number, originLon: number, originLat: number, visit: (cx: number, cy: number) => void): void {
  const fx = (x0 - originLon) / CELL_MICRO;
  const fy = (y0 - originLat) / CELL_MICRO;
  const tx = (x1 - originLon) / CELL_MICRO;
  const ty = (y1 - originLat) / CELL_MICRO;
  let cx = Math.floor(fx);
  let cy = Math.floor(fy);
  const ex = Math.floor(tx);
  const ey = Math.floor(ty);
  visit(cx, cy);
  const dx = tx - fx;
  const dy = ty - fy;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  let nextX = dx === 0 ? Infinity : ((stepX > 0 ? cx + 1 : cx) - fx) / dx;
  let nextY = dy === 0 ? Infinity : ((stepY > 0 ? cy + 1 : cy) - fy) / dy;
  const deltaX = dx === 0 ? Infinity : stepX / dx;
  const deltaY = dy === 0 ? Infinity : stepY / dy;
  let guard = Math.abs(ex - cx) + Math.abs(ey - cy) + 4;
  while ((cx !== ex || cy !== ey) && guard-- > 0) {
    if (nextX < nextY) {
      cx += stepX;
      nextX += deltaX;
    } else if (nextY < nextX) {
      cy += stepY;
      nextY += deltaY;
    } else {
      cx += stepX;
      cy += stepY;
      nextX += deltaX;
      nextY += deltaY;
    }
    visit(cx, cy);
  }
}

function writeHierarchy(w: Writer, h: Hierarchy, up: boolean, mirrors: { up: Uint8Array; down: Uint8Array } | null): void {
  const first = up ? h.upFirst : h.downFirst;
  const other = up ? h.upTo : h.downFrom;
  const weight = up ? h.upW : h.downW;
  const length = up ? h.upLen : h.downLen;
  const via = up ? h.upVia : h.downVia;
  const skip = mirrors && !up ? mirrors.down : null;
  const flag = mirrors && up ? mirrors.up : null;
  let total = other.length;
  if (skip) for (let i = 0; i < skip.length; i++) total -= skip[i] as number;
  w.u(total);
  for (let v = 0; v < h.n; v++) {
    const from = first[v] as number;
    const to = first[v + 1] as number;
    let count = to - from;
    if (skip) for (let i = from; i < to; i++) count -= skip[i] as number;
    w.u(count);
    let previous = v;
    let firstKept = true;
    for (let i = from; i < to; i++) {
      if (skip?.[i] === 1) continue;
      w.u((other[i] as number) - previous - (firstKept ? 1 : 0));
      firstKept = false;
      previous = other[i] as number;
      w.u(weight[i] as number);
      w.u(length[i] as number);
      const raw = via[i] as number;
      const encoded = raw >= ORIGINAL ? (raw & VIA_MASK) * 2 + 1 : raw * 2;
      w.u(flag ? encoded * 2 + (flag[i] as number) : encoded);
    }
  }
}

export function buildRoutePack(rows: RoadRows, options: GraphOptions & { plate?: string; format?: RouteFormat }): { bytes: Uint8Array; report: PackReport; graph: RoadGraph } {
  const format = options.format ?? VERSION;
  const base = buildBaseGraph(rows, options);
  const graph = applyRestrictions(base, options.comparison === true ? [] : rows.rules);
  const component = largestComponent(buildCsr(graph.nodeCount, graph.arcTail, graph.arcHead, graph.arcDs));
  const arcLen = Uint32Array.from(graph.arcPa, (pa) => Math.round((base.edges[pa >> 1] as { lengthM: number }).lengthM));
  const { hierarchy, toNew, stats } = contract({ n: graph.nodeCount, tail: graph.arcTail, head: graph.arcHead, ds: graph.arcDs, len: arcLen, pa: graph.arcPa });

  const baseCount = base.nodeLon.length;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const widen = (lon: number, lat: number): void => {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  };
  for (let i = 0; i < baseCount; i++) widen(base.nodeLon[i] as number, base.nodeLat[i] as number);
  for (const e of base.edges) for (let k = 0; k < e.shape.length; k += 2) widen(e.shape[k] as number, e.shape[k + 1] as number);
  if (baseCount === 0) minLon = minLat = maxLon = maxLat = 0;
  const originLon = Math.floor(minLon / CELL_MICRO) * CELL_MICRO;
  const originLat = Math.floor(minLat / CELL_MICRO) * CELL_MICRO;
  const cols = Math.floor((maxLon - originLon) / CELL_MICRO) + 1;
  const rowsCount = Math.floor((maxLat - originLat) / CELL_MICRO) + 1;

  const sections: Record<string, number> = {};
  const parts: [number, Uint8Array][] = [];
  const part = (id: number, name: string, w: Writer): void => {
    const bytes = w.bytes();
    sections[name] = bytes.length;
    parts.push([id, bytes]);
  };

  const nodes = createWriter();
  let px = 0;
  let py = 0;
  for (let i = 0; i < baseCount; i++) {
    nodes.z((base.nodeLon[i] as number) - px);
    nodes.z((base.nodeLat[i] as number) - py);
    px = base.nodeLon[i] as number;
    py = base.nodeLat[i] as number;
    nodes.u(toNew[i] as number);
  }
  part(SECTION.nodes, 'nodes', nodes);

  const edges = createWriter();
  const shapes = createWriter();
  const cellMembers = new Map<number, number[]>();
  let previousTail = 0;
  for (let i = 0; i < base.edges.length; i++) {
    const e = base.edges[i]!;
    const main = component.inside[e.tail] === 1 && component.inside[e.head] === 1;
    const penaltyForward = e.forward && e.ds[0] > e.travel[0];
    const penaltyBackward = e.backward && e.ds[1] > e.travel[1];
    const flags = (e.forward ? FLAG.forward : 0) | (e.backward ? FLAG.backward : 0) | (main ? FLAG.main : 0) | (penaltyForward ? FLAG.penaltyForward : 0) | (penaltyBackward ? FLAG.penaltyBackward : 0) | (e.cls << FLAG.classShift);
    const shape = createWriter();
    shape.u(e.shape.length / 2);
    let x = base.nodeLon[e.tail] as number;
    let y = base.nodeLat[e.tail] as number;
    for (let k = 0; k < e.shape.length; k += 2) {
      shape.z((e.shape[k] as number) - x);
      shape.z((e.shape[k + 1] as number) - y);
      x = e.shape[k] as number;
      y = e.shape[k + 1] as number;
    }
    const shapeBytes = shape.bytes();
    edges.z(e.tail - previousTail);
    previousTail = e.tail;
    edges.z(e.head - e.tail);
    edges.u(flags);
    edges.u(Math.round(e.lengthM));
    edges.u(e.travel[0]);
    edges.u(e.travel[1]);
    edges.u(shapeBytes.length);
    for (const b of shapeBytes) shapes.byte(b);

    const line = [base.nodeLon[e.tail] as number, base.nodeLat[e.tail] as number, ...e.shape, base.nodeLon[e.head] as number, base.nodeLat[e.head] as number];
    const touched = new Set<number>();
    for (let k = 0; k + 3 < line.length; k += 2) {
      cellsOfSegment(line[k] as number, line[k + 1] as number, line[k + 2] as number, line[k + 3] as number, originLon, originLat, (cx, cy) => {
        if (cx >= 0 && cy >= 0 && cx < cols && cy < rowsCount) touched.add(cy * cols + cx);
      });
    }
    for (const cell of touched) {
      const list = cellMembers.get(cell);
      if (list) list.push(i);
      else cellMembers.set(cell, [i]);
    }
  }
  part(SECTION.edges, 'edges', edges);
  part(SECTION.shapes, 'shapes', shapes);

  const mirrors = format === MIRROR_VERSION ? mirrorFlags(hierarchy) : null;
  const up = createWriter();
  writeHierarchy(up, hierarchy, true, mirrors);
  part(SECTION.up, 'up', up);
  const down = createWriter();
  writeHierarchy(down, hierarchy, false, mirrors);
  part(SECTION.down, 'down', down);

  const entry = createWriter();
  const entries = [...graph.entry].sort((a, b) => a[0] - b[0]);
  entry.u(entries.length);
  let previousKey = 0;
  for (const [pa, node] of entries) {
    entry.u(pa - previousKey);
    previousKey = pa;
    entry.u(toNew[node] as number);
  }
  part(SECTION.entry, 'entry', entry);

  const exits = createWriter();
  const exitList: [number, number][] = [];
  for (const [pa, list] of graph.exits) for (const node of list) exitList.push([pa, toNew[node] as number]);
  exitList.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  exits.u(exitList.length);
  previousKey = 0;
  for (const [pa, node] of exitList) {
    exits.u(pa - previousKey);
    previousKey = pa;
    exits.u(node);
  }
  part(SECTION.exits, 'exits', exits);

  const grid = createWriter();
  grid.z(originLon);
  grid.z(originLat);
  grid.u(CELL_MICRO);
  grid.u(cols);
  grid.u(rowsCount);
  const cells = cols * rowsCount;
  for (let c = 0; c < cells; c++) grid.u(cellMembers.get(c)?.length ?? 0);
  for (let c = 0; c < cells; c++) {
    let previous = 0;
    for (const edge of cellMembers.get(c) ?? []) {
      grid.u(edge - previous);
      previous = edge;
    }
  }
  part(SECTION.grid, 'grid', grid);

  const tableBytes = 44 + parts.length * 9;
  let offset = tableBytes;
  const file = new Uint8Array(tableBytes + parts.reduce((sum, p) => sum + p[1].length, 0));
  const view = new DataView(file.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, format, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, graph.nodeCount, true);
  view.setUint32(12, baseCount, true);
  view.setUint32(16, base.edges.length, true);
  view.setInt32(20, minLon, true);
  view.setInt32(24, minLat, true);
  view.setInt32(28, maxLon, true);
  view.setInt32(32, maxLat, true);
  view.setUint32(40, parts.length, true);
  parts.forEach(([id, bytes], i) => {
    view.setUint8(44 + i * 9, id);
    view.setUint32(44 + i * 9 + 1, offset, true);
    view.setUint32(44 + i * 9 + 5, bytes.length, true);
    file.set(bytes, offset);
    offset += bytes.length;
  });

  return {
    bytes: file,
    graph,
    report: {
      baseNodes: baseCount,
      edges: base.edges.length,
      graphNodes: graph.nodeCount,
      copies: graph.report.copies,
      rules: { total: graph.report.rules, applied: graph.report.applied, skipped: graph.report.skipped },
      arcs: stats.arcs,
      shortcuts: stats.shortcuts,
      options: { ferries: options.ferries, minComponent: options.minComponent ?? 1, ...(options.plate === undefined ? {} : { plate: options.plate }) },
      mainShare: component.size / Math.max(1, graph.nodeCount),
      dropped: base.dropped,
      gridCells: cells,
      bytes: file.length,
      sections,
    },
  };
}

export function rewriteRoutePack(bytes: Uint8Array, format: RouteFormat): Uint8Array {
  const { hierarchy } = readRoutePack(bytes);
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mirrors = format === MIRROR_VERSION ? mirrorFlags(hierarchy) : null;
  const parts: [number, Uint8Array][] = [];
  for (let i = 0; i < source.getUint32(40, true); i++) {
    const at = 44 + i * 9;
    const id = source.getUint8(at);
    const start = source.getUint32(at + 1, true);
    if (id !== SECTION.up && id !== SECTION.down) {
      parts.push([id, bytes.subarray(start, start + source.getUint32(at + 5, true))]);
      continue;
    }
    const w = createWriter();
    writeHierarchy(w, hierarchy, id === SECTION.up, mirrors);
    parts.push([id, w.bytes()]);
  }
  const tableBytes = 44 + parts.length * 9;
  const file = new Uint8Array(tableBytes + parts.reduce((sum, p) => sum + p[1].length, 0));
  file.set(bytes.subarray(0, 44));
  const view = new DataView(file.buffer);
  view.setUint16(4, format, true);
  let offset = tableBytes;
  parts.forEach(([id, part], i) => {
    view.setUint8(44 + i * 9, id);
    view.setUint32(44 + i * 9 + 1, offset, true);
    view.setUint32(44 + i * 9 + 5, part.length, true);
    file.set(part, offset);
    offset += part.length;
  });
  return file;
}
