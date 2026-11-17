import { geohash } from '../../src/core/traffic/observed';
import { cellName, decodeLines, encodeLines, splitByCell, type Pt } from '../../pipeline/build/road-cells';

const Z = 14;
const tileOf = (lng: number, lat: number): [number, number] => {
  const n = 2 ** Z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return [x, y];
};

describe('road cells', () => {
  it('names cells like geohash does', () => {
    const col = Math.floor((29.0203857 + 180) / (360 / 32768));
    const row = Math.floor((41.0971069 + 90) / (180 / 32768));
    expect(cellName(col, row)).toBe(geohash(41.0971069, 29.0203857, 6));
  });

  it('round-trips line geometry', () => {
    const lines: Pt[][] = [[[10, 20], [300, -40], [4000, 4100]], [[0, 0], [5, 5]]];
    expect(decodeLines(encodeLines(lines))).toEqual(lines);
  });

  it('cuts a line where it crosses into the next cell and names every piece by its own cell', () => {
    const [x, y] = tileOf(29.02, 41.09);
    const lines: Pt[][] = [[[0, 2048], [4095, 2048]]];
    const pieces = splitByCell(lines, Z, x, y, 4096);
    expect(pieces.length).toBeGreaterThan(1);
    expect(new Set(pieces.map((p) => p.cell)).size).toBe(pieces.length);
    expect(pieces[0]?.line[0]).toEqual([0, 2048]);
    expect(pieces[pieces.length - 1]?.line.slice(-1)[0]).toEqual([4095, 2048]);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i]?.line[0]).toEqual(pieces[i - 1]?.line.slice(-1)[0]);
  });

  it('keeps a short line in one cell whole', () => {
    const [x, y] = tileOf(29.0, 41.0);
    const pieces = splitByCell([[[100, 100], [140, 120]]], 16, x * 4, y * 4, 4096);
    expect(pieces).toHaveLength(1);
  });
});
