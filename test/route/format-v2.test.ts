import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRoutePack, mirrorFlags, rewriteRoutePack, routeFormat, routeMinSdk } from '../../pipeline/build/route-pack';
import { MIRROR_VERSION, mirrorVia, readRoutePack, SECTION, VERSION } from '../../src/core/route/format';
import { ORIGINAL } from '../../src/core/route/hierarchy';
import { createPlanner } from '../../src/core/route/planner';
import { deg, rows, way, type Pt } from '../helpers/road-world';

const X = 29;
const Y = 41;
const lon = (meters: number): number => deg(meters) / Math.cos((Y * Math.PI) / 180);
const at = (i: number, j: number): Pt => [100 + i * 10 + j, X + lon(i * 250), Y + deg(j * 250)];

function world() {
  const ways = [];
  for (let j = 0; j < 6; j++) ways.push(way(100 + j, Array.from({ length: 6 }, (_, i) => at(i, j)), { oneway: j === 2 ? 'f' : '' }));
  for (let i = 0; i < 6; i++) ways.push(way(200 + i, Array.from({ length: 6 }, (_, j) => at(i, j)), { cls: i === 3 ? 'primary' : 'residential' }));
  return rows(ways, [{ id: 1, kind: 'no', restriction: 'no_left_turn', from: 200, to: 101, via: [{ n: 111 }] }]);
}

const hierarchyOf = (bytes: Uint8Array) => readRoutePack(bytes).hierarchy;
const sectionLength = (bytes: Uint8Array, id: number): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < view.getUint32(40, true); i++) if (view.getUint8(44 + i * 9) === id) return view.getUint32(44 + i * 9 + 5, true);
  throw new Error(`no section ${id}`);
};

describe('route pack version 2', () => {
  const v1 = buildRoutePack(world(), { ferries: false }).bytes;
  const v2 = buildRoutePack(world(), { ferries: false, format: MIRROR_VERSION }).bytes;

  it('reads back exactly the same hierarchy as version 1', () => {
    expect(new DataView(v2.buffer).getUint16(4, true)).toBe(MIRROR_VERSION);
    expect(hierarchyOf(v2)).toEqual(hierarchyOf(v1));
    expect(readRoutePack(v2).edges).toEqual(readRoutePack(v1).edges);
  });

  it('stores a reverse arc once and is smaller', () => {
    const flags = mirrorFlags(hierarchyOf(v1));
    expect(flags.up.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(sectionLength(v2, SECTION.down)).toBeLessThan(sectionLength(v1, SECTION.down));
    expect(v2.length).toBeLessThan(v1.length);
  });

  it('finds the same routes and the same matrix', () => {
    const one = createPlanner(readRoutePack(v1));
    const two = createPlanner(readRoutePack(v2));
    const count = readRoutePack(v1).edges.count;
    const snaps = Array.from({ length: 12 }, (_, i) => ({ edge: (i * 7) % count, offsetM: (i * 37) % 200, distanceM: 0, point: [0, 0] as [number, number] }));
    for (const a of snaps) for (const b of snaps) expect(two.route(a, b)).toEqual(one.route(a, b));
    expect(two.matrix(snaps, snaps)).toEqual(one.matrix(snaps, snaps));
  });

  it('can be rewritten from version 1 and back without a change', () => {
    expect(Buffer.from(rewriteRoutePack(v1, MIRROR_VERSION)).equals(Buffer.from(v2))).toBe(true);
    expect(Buffer.from(rewriteRoutePack(v2, VERSION)).equals(Buffer.from(v1))).toBe(true);
    expect(Buffer.from(rewriteRoutePack(v1, VERSION)).equals(Buffer.from(v1))).toBe(true);
  });

  it('refuses version 1 data that says it is version 2', () => {
    const tampered = v1.slice();
    new DataView(tampered.buffer).setUint16(4, MIRROR_VERSION, true);
    expect(() => readRoutePack(tampered)).toThrow(/route pack/);
  });
});

const withSection = (bytes: Uint8Array, id: number, part: Uint8Array): Uint8Array => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(40, true);
  const parts = Array.from({ length: count }, (_, i) => {
    const at = 44 + i * 9;
    const start = view.getUint32(at + 1, true);
    return { id: view.getUint8(at), data: view.getUint8(at) === id ? part : bytes.subarray(start, start + view.getUint32(at + 5, true)) };
  });
  const head = 44 + count * 9;
  const out = new Uint8Array(head + parts.reduce((sum, p) => sum + p.data.length, 0));
  out.set(bytes.subarray(0, 44));
  const outView = new DataView(out.buffer);
  let offset = head;
  parts.forEach((p, i) => {
    outView.setUint8(44 + i * 9, p.id);
    outView.setUint32(44 + i * 9 + 1, offset, true);
    outView.setUint32(44 + i * 9 + 5, p.data.length, true);
    out.set(p.data, offset);
    offset += p.data.length;
  });
  return out;
};

describe('a mirrored arc that is also stored', () => {
  it('is refused instead of being read twice', () => {
    const v1 = buildRoutePack(world(), { ferries: false }).bytes;
    const v2 = buildRoutePack(world(), { ferries: false, format: MIRROR_VERSION }).bytes;
    const view = new DataView(v1.buffer, v1.byteOffset, v1.byteLength);
    let full: Uint8Array = new Uint8Array(0);
    for (let i = 0; i < view.getUint32(40, true); i++) {
      const at = 44 + i * 9;
      if (view.getUint8(at) === SECTION.down) full = v1.subarray(view.getUint32(at + 1, true), view.getUint32(at + 1, true) + view.getUint32(at + 5, true));
    }
    expect(() => readRoutePack(withSection(v2, SECTION.down, full))).toThrow('mirror clash');
  });
});

describe('mirrorVia', () => {
  it('turns an original arc around and leaves a shortcut alone', () => {
    expect(mirrorVia(ORIGINAL)).toBe(ORIGINAL + 1);
    expect(mirrorVia(ORIGINAL - 1)).toBe(ORIGINAL - 1);
    expect(mirrorVia(ORIGINAL + 10)).toBe(ORIGINAL + 11);
    expect(mirrorVia(ORIGINAL + 11)).toBe(ORIGINAL + 10);
    expect(mirrorVia(42)).toBe(42);
  });
});

describe('routeFormat', () => {
  it('writes version 2 only for an SDK that reads it', () => {
    expect(routeFormat('0.5.0', undefined)).toBe(VERSION);
    expect(routeFormat('0.6.0', undefined)).toBe(MIRROR_VERSION);
    expect(routeFormat('1.2.0', '')).toBe(MIRROR_VERSION);
  });

  it('can be forced either way and refuses anything else', () => {
    expect(routeFormat('0.5.0', '2')).toBe(MIRROR_VERSION);
    expect(routeFormat('0.6.0', '1')).toBe(VERSION);
    expect(() => routeFormat('0.5.0', '3')).toThrow(/GEO_ROUTE_FORMAT/);
  });
});

describe('routeMinSdk', () => {
  it('asks for the SDK that can read every route pack in the release', () => {
    const dir = mkdtempSync(join(tmpdir(), 'route-sdk-'));
    const one = join(dir, 'a.bin');
    const two = join(dir, 'b.bin');
    writeFileSync(one, buildRoutePack(world(), { ferries: false }).bytes);
    writeFileSync(two, buildRoutePack(world(), { ferries: false, format: MIRROR_VERSION }).bytes);
    expect(routeMinSdk([])).toBe('0.3.0');
    expect(routeMinSdk([one])).toBe('0.3.0');
    expect(routeMinSdk([one, two])).toBe('0.6.0');
    const odd = join(dir, 'c.bin');
    writeFileSync(odd, Uint8Array.from([0x59, 0x47, 0x52, 0x54, 9, 0]));
    expect(() => routeMinSdk([odd])).toThrow(/sürümü 9/);
  });
});
