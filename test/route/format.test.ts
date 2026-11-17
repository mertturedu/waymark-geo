import { contract } from '../../pipeline/build/route-ch';
import { buildRoutePack } from '../../pipeline/build/route-pack';
import { cursorOf } from '../../src/core/route/bytes';
import { readRoutePack, SECTION } from '../../src/core/route/format';
import { createPlanner } from '../../src/core/route/planner';
import { deg, rows, way, type Pt } from '../helpers/road-world';

const X = 29;
const Y = 41;
const lon = (meters: number): number => deg(meters) / Math.cos((Y * Math.PI) / 180);
const at = (i: number, j: number): Pt => [100 + i * 10 + j, X + lon(i * 250), Y + deg(j * 250)];

function sample(): Uint8Array {
  const ways = [];
  for (let j = 0; j < 5; j++) ways.push(way(100 + j, Array.from({ length: 5 }, (_, i) => at(i, j)), { oneway: j === 2 ? 'f' : '' }));
  for (let i = 0; i < 5; i++) ways.push(way(200 + i, Array.from({ length: 5 }, (_, j) => at(i, j))));
  return buildRoutePack(rows(ways, [{ id: 1, kind: 'no', restriction: 'no_left_turn', from: 200, to: 101, via: [{ n: 111 }] }]), { ferries: false }).bytes;
}

const isPackError = (error: unknown): boolean => error instanceof Error && (error as Error & { code?: string }).code === 'route_pack_corrupt';

function lcg(seed: number): () => number {
  let state = seed;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000;
}

describe('readRoutePack memory', () => {
  it('copies the shapes out so the whole file can be let go', () => {
    const bytes = sample();
    const pack = readRoutePack(bytes);
    expect(pack.edges.shapes.buffer).not.toBe(bytes.buffer);
    expect(pack.edges.shapes.buffer.byteLength).toBe(pack.edges.shapes.length);
  });
});

describe('readRoutePack on damaged input', () => {
  const good = sample();

  it('rejects nothing, a wrong file, a wrong version and an impossible section table', () => {
    expect(() => readRoutePack(new Uint8Array(0))).toThrow(/too short/);
    expect(() => readRoutePack(new Uint8Array(100))).toThrow(/not a route pack/);
    const version = good.slice();
    new DataView(version.buffer).setUint16(4, 9, true);
    expect(() => readRoutePack(version)).toThrow(/unknown version/);
    const table = good.slice();
    new DataView(table.buffer).setUint32(40, 99, true);
    expect(() => readRoutePack(table)).toThrow(/bad section table/);
    const missing = good.slice();
    new DataView(missing.buffer).setUint8(44, 77);
    expect(() => readRoutePack(missing)).toThrow(/missing section/);
    const far = good.slice();
    new DataView(far.buffer).setUint32(44 + 1, 0xfffffff0, true);
    expect(() => readRoutePack(far)).toThrow(/out of range/);
  });

  it('rejects counts that are larger than the file could hold', () => {
    for (const offset of [8, 12, 16]) {
      const big = good.slice();
      new DataView(big.buffer).setUint32(offset, 60_000_000, true);
      expect(() => readRoutePack(big)).toThrow(/size/);
    }
  });

  it('rejects every cut of the file', () => {
    for (let cut = 0; cut < good.length; cut += Math.max(1, Math.floor(good.length / 60))) {
      expect(() => readRoutePack(good.slice(0, cut))).toThrow(/route pack/);
    }
  });

  it('either rejects a flipped byte cleanly or keeps answering queries without hanging (property)', () => {
    const rnd = lcg(42);
    let rejected = 0;
    let opened = 0;
    for (let round = 0; round < 400; round++) {
      const bytes = good.slice();
      for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) bytes[Math.floor(rnd() * bytes.length)] = Math.floor(rnd() * 256);
      try {
        const pack = readRoutePack(bytes);
        opened++;
        const planner = createPlanner(pack);
        const snaps = Array.from({ length: 4 }, () => {
          const edge = Math.floor(rnd() * Math.max(1, pack.edges.count));
          return { edge, offsetM: rnd() * 300, distanceM: 0, point: [0, 0] as [number, number] };
        });
        for (const a of snaps) for (const b of snaps) if (a.edge < pack.edges.count && b.edge < pack.edges.count) planner.route(a, b);
      } catch (error) {
        expect(isPackError(error) || error instanceof RangeError || error instanceof TypeError).toBe(true);
        rejected++;
      }
    }
    expect(rejected).toBeGreaterThan(50);
    expect(opened).toBeGreaterThan(0);
  });
});

describe('readRoutePack against what the builder wrote', () => {
  const rules = [
    { id: 1, kind: 'no' as const, restriction: 'no_left_turn', from: 201, to: 101, via: [{ n: 111 }] },
    { id: 2, kind: 'only' as const, restriction: 'only_straight_on', from: 202, to: 101, via: [{ n: 121 }] },
  ];
  const build = () => {
    const ways = [];
    for (let j = 0; j < 5; j++) ways.push(way(100 + j, Array.from({ length: 5 }, (_, i) => at(i, j)), { oneway: j === 2 ? 'f' : '' }));
    for (let i = 0; i < 5; i++) ways.push(way(200 + i, Array.from({ length: 5 }, (_, j) => at(i, j))));
    return buildRoutePack(rows(ways, rules), { ferries: false });
  };

  it('reads back exactly the hierarchy, the tables, the box and the nodes', () => {
    const built = build();
    const pack = readRoutePack(built.bytes);
    const { graph } = built;
    const arcLen = Uint32Array.from(graph.arcPa, (pa) => Math.round(graph.base.edges[pa >> 1]!.lengthM));
    const { hierarchy, toNew } = contract({ n: graph.nodeCount, tail: graph.arcTail, head: graph.arcHead, ds: graph.arcDs, len: arcLen, pa: graph.arcPa });
    for (const key of ['upFirst', 'upTo', 'upW', 'upLen', 'upVia', 'downFirst', 'downFrom', 'downW', 'downLen', 'downVia'] as const) {
      expect(Array.from(pack.hierarchy[key])).toEqual(Array.from(hierarchy[key]));
    }
    expect(pack.hierarchy.n).toBe(graph.nodeCount);
    expect(Array.from(pack.entry.key)).toEqual([...graph.entry.keys()].sort((a, b) => a - b));
    expect(Array.from(pack.entry.node)).toEqual([...graph.entry.keys()].sort((a, b) => a - b).map((pa) => toNew[graph.entry.get(pa) as number]));
    const pairs = [...graph.exits].flatMap(([pa, list]) => list.map((node) => [pa, toNew[node] as number])).sort((a, b) => (a[0] as number) - (b[0] as number) || (a[1] as number) - (b[1] as number));
    expect(Array.from(pack.exits.key)).toEqual(pairs.map((p) => p[0]));
    expect(Array.from(pack.exits.node)).toEqual(pairs.map((p) => p[1]));
    expect(Array.from(pack.base.node)).toEqual(Array.from(toNew.subarray(0, graph.base.nodeLon.length)));
    expect(Array.from(pack.base.lon)).toEqual(graph.base.nodeLon);
    expect(Array.from(pack.base.lat)).toEqual(graph.base.nodeLat);
    expect(pack.bbox).toEqual([Math.min(...graph.base.nodeLon), Math.min(...graph.base.nodeLat), Math.max(...graph.base.nodeLon), Math.max(...graph.base.nodeLat)]);
    expect(pack.grid.cell).toBe(5000);
    expect(pack.grid.first[pack.grid.first.length - 1]).toBe(pack.grid.edges.length);
  });

  it('turns every kind of damage into its own message', () => {
    const good = build().bytes;
    const view = new DataView(good.buffer, good.byteOffset, good.byteLength);
    const table = new Map<number, [number, number]>();
    for (let i = 0; i < view.getUint32(40, true); i++) table.set(view.getUint8(44 + i * 9), [view.getUint32(44 + i * 9 + 1, true), view.getUint32(44 + i * 9 + 5, true)]);
    const messages = new Set<string>();
    for (const [id, [offset, length]] of table) {
      expect(Object.values(SECTION)).toContain(id);
      for (let p = 0; p < Math.min(length, 400); p++) {
        for (const value of [0, 1, 2, 3, 0x7f, 0x80, 0xff]) {
          const bytes = good.slice();
          bytes[offset + p] = value;
          try {
            readRoutePack(bytes);
          } catch (error) {
            messages.add((error as Error).message);
          }
        }
      }
    }
    for (const message of ['route pack: entry count', 'route pack: entry overflow', 'route pack: node out of range', 'route pack: shortcut middle', 'route pack: entry count mismatch', 'route pack: pair count', 'route pack: pair node', 'route pack: base node', 'route pack: edge node', 'route pack: edge flags', 'route pack: shape size', 'route pack: grid size', 'route pack: grid edge', 'route pack: truncated']) {
      expect(messages).toContain(message);
    }
  });

  it('refuses headers whose limits are exactly crossed', () => {
    const good = build().bytes;
    const patch = (offset: number, value: number, bits: 16 | 32 = 32): Uint8Array => {
      const bytes = good.slice();
      const v = new DataView(bytes.buffer);
      if (bits === 32) v.setUint32(offset, value, true);
      else v.setUint16(offset, value, true);
      return bytes;
    };
    expect(() => readRoutePack(good.slice(0, 44))).toThrow(/bad section table/);
    expect(() => readRoutePack(patch(40, 32))).toThrow(/bad section table|out of range|missing/);
    expect(() => readRoutePack(patch(40, 33))).toThrow(/bad section table/);
    expect(() => readRoutePack(patch(8, good.length + 1))).toThrow(/size/);
    expect(() => readRoutePack(patch(12, 1 << 26))).toThrow(/size/);
    expect(() => readRoutePack(patch(16, (1 << 26) + 1))).toThrow(/size/);
    expect(() => readRoutePack(good.slice(0, 43))).toThrow(/too short/);
    const exact = good.slice(0, 44);
    new DataView(exact.buffer).setUint32(40, 0, true);
    expect(() => readRoutePack(exact)).toThrow(/missing section/);
  });
});

describe('readRoutePack allocation limits', () => {
  it('refuses a grid larger than its own section could describe before allocating it', () => {
    const good = sample();
    const view = new DataView(good.buffer);
    let gridStart = 0;
    for (let i = 0; i < view.getUint32(40, true); i++) if (view.getUint8(44 + i * 9) === SECTION.grid) gridStart = view.getUint32(44 + i * 9 + 1, true);
    const c = cursorOf(good, gridStart, good.length);
    c.z();
    c.z();
    c.u();
    const colsAt = c.pos();
    c.u();
    const rowsAt = c.pos();
    const big = good.slice();
    big[colsAt] = 0x7f;
    big[rowsAt] = 0x7f;
    expect(() => readRoutePack(big)).toThrow(/grid size/);
  });
});
