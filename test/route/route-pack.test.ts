import { buildRoutePack } from '../../pipeline/build/route-pack';
import { edgeLine, readRoutePack, FLAG } from '../../src/core/route/format';
import { rows, way } from '../helpers/road-world';
import { snapPoint } from '../../src/core/route/snap';

const X = 29;
const Y = 41;
const D = 0.001;

function town(): ReturnType<typeof rows> {
  const a = way(1, [[1, X, Y], [2, X + D, Y], [3, X + 2 * D, Y]], { cls: 'tertiary' });
  const b = way(2, [[2, X + D, Y], [4, X + D, Y + D], [5, X + D, Y + 2 * D]], { oneway: 'f' });
  const c = way(3, [[3, X + 2 * D, Y], [6, X + 2 * D, Y + D], [5, X + D, Y + 2 * D]]);
  const island = way(4, [[20, X + 1, Y + 1], [21, X + 1.001, Y + 1]]);
  const rule = { id: 1, kind: 'no' as const, restriction: 'no_right_turn', from: 1, to: 2, via: [{ n: 2 }] };
  return rows([a, b, c, island], [rule]);
}

describe('buildRoutePack and readRoutePack', () => {
  it('writes a file the reader opens with the same counts and edge facts', () => {
    const { bytes, report, graph } = buildRoutePack(town(), { ferries: false });
    const pack = readRoutePack(bytes);
    expect(pack.edges.count).toBe(graph.base.edges.length);
    expect(pack.base.count).toBe(graph.base.nodeLon.length);
    expect(pack.hierarchy.n).toBe(graph.nodeCount);
    expect(report.edges).toBe(pack.edges.count);
    graph.base.edges.forEach((e, i) => {
      expect(pack.edges.tail[i]).toBe(e.tail);
      expect(pack.edges.head[i]).toBe(e.head);
      expect(pack.edges.length[i]).toBe(Math.round(e.lengthM));
      expect(pack.edges.travel[2 * i]).toBe(e.travel[0]);
      expect(pack.edges.travel[2 * i + 1]).toBe(e.travel[1]);
      const flags = pack.edges.flags[i] as number;
      expect(Boolean(flags & FLAG.forward)).toBe(e.forward);
      expect(Boolean(flags & FLAG.backward)).toBe(e.backward);
      expect(flags >> FLAG.classShift).toBe(e.cls);
    });
  });

  it('keeps every edge shape including both ends', () => {
    const { bytes, graph } = buildRoutePack(town(), { ferries: false });
    const pack = readRoutePack(bytes);
    graph.base.edges.forEach((e, i) => {
      const line = edgeLine(pack, i);
      expect(line.slice(0, 2)).toEqual([graph.base.nodeLon[e.tail], graph.base.nodeLat[e.tail]]);
      expect(line.slice(2, -2)).toEqual(e.shape);
      expect(line.slice(-2)).toEqual([graph.base.nodeLon[e.head], graph.base.nodeLat[e.head]]);
    });
  });

  it('marks the main network and leaves the island out of it', () => {
    const { bytes, report } = buildRoutePack(town(), { ferries: false });
    const pack = readRoutePack(bytes);
    const main = Array.from(pack.edges.flags).map((f) => Boolean(f & FLAG.main));
    expect(main.filter(Boolean).length).toBeGreaterThan(0);
    expect(main[main.length - 1]).toBe(false);
    expect(report.mainShare).toBeGreaterThan(0.5);
    expect(report.mainShare).toBeLessThan(1);
  });

  it('records the copies a turn ban needs as entry and exit tables', () => {
    const { bytes, report } = buildRoutePack(town(), { ferries: false });
    const pack = readRoutePack(bytes);
    expect(report.copies).toBe(1);
    expect(pack.entry.key.length).toBe(1);
    expect(pack.exits.key.length).toBeGreaterThan(0);
  });

  it('lists each edge in the grid cells it crosses', () => {
    const { bytes } = buildRoutePack(town(), { ferries: false });
    const { grid, edges, base } = readRoutePack(bytes);
    for (let e = 0; e < edges.count; e++) {
      const cx = Math.floor(((base.lon[edges.tail[e] as number] as number) - grid.originLon) / grid.cell);
      const cy = Math.floor(((base.lat[edges.tail[e] as number] as number) - grid.originLat) / grid.cell);
      const cell = cy * grid.cols + cx;
      expect(Array.from(grid.edges.subarray(grid.first[cell] as number, grid.first[cell + 1] as number))).toContain(e);
    }
  });

  it('is byte for byte the same on a second build', () => {
    const a = buildRoutePack(town(), { ferries: false }).bytes;
    const b = buildRoutePack(town(), { ferries: false }).bytes;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('keeps a ferry with an absurd posted duration to a time the pack can hold', () => {
    const ferry = way(1, [[1, X, Y], [2, X + 0.05, Y]], { cls: 'ferry', ferry: true, duration: 6_000_000_000 });
    const { bytes } = buildRoutePack(rows([ferry]), { ferries: true });
    const pack = readRoutePack(bytes);
    expect(pack.edges.travel[0]).toBeLessThan(2 ** 32);
    expect(pack.edges.travel[0]).toBeGreaterThan(0);
  });

  it('snaps onto a road piece that bulges far outside the box of the junctions', () => {
    const bulge = way(1, [[1, X, Y], [2, X + D * 20, Y + D * 50], [3, X + D * 40, Y]]);
    const { bytes } = buildRoutePack(rows([bulge]), { ferries: false });
    const pack = readRoutePack(bytes);
    const apexCell = Math.floor(((Y + D * 50) * 1e6 - pack.grid.originLat) / pack.grid.cell);
    expect(apexCell).toBeLessThan(pack.grid.rows);
    expect(snapPoint(pack, X + D * 20, Y + D * 50 + 0.0001)).toMatchObject({ ok: true });
  });
});
