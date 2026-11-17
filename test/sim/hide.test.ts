import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { builtPack } from '../address/helpers/search-fixture';
import { chooseHidden, hidePack, readDoors } from './hide';
import { rng } from './random';

let file = '';
beforeAll(async () => {
  file = await builtPack();
});

describe('readDoors', () => {
  it('reads the doors that sit on a street, with their coordinates', () => {
    const doors = readDoors(file);
    expect(doors.length).toBeGreaterThan(20);
    const bahariye = doors.filter((d) => d.nkey === '14');
    expect(bahariye.length).toBeGreaterThan(0);
    expect(bahariye[0]).toMatchObject({ num: 14, parity: 0 });
    expect(doors.every((d) => d.lng > 28 && d.lng < 30)).toBe(true);
    expect(doors.map((d) => d.id)).toEqual([...doors.map((d) => d.id)].sort((a, b) => a - b));
  });
});

describe('chooseHidden', () => {
  it('picks the asked share, repeatably, and nothing twice', () => {
    const all = readDoors(file);
    const a = chooseHidden(all, 0.2, rng(4));
    expect(a.size).toBe(Math.round(all.length * 0.2));
    expect([...chooseHidden(all, 0.2, rng(4))]).toEqual([...a]);
    expect([...chooseHidden(all, 0.2, rng(5))]).not.toEqual([...a]);
    expect(chooseHidden(all, 0, rng(1)).size).toBe(0);
    expect(chooseHidden(all, 1, rng(1)).size).toBe(all.length);
    expect(chooseHidden(all, 7, rng(1)).size).toBe(all.length);
    expect(chooseHidden([], 0.5, rng(1)).size).toBe(0);
  });
});

describe('hidePack', () => {
  it('removes exactly the chosen doors from a copy and leaves the original alone', () => {
    const all = readDoors(file);
    const hide = new Set(all.slice(0, 5).map((d) => d.id));
    const dest = join(mkdtempSync(join(tmpdir(), 'geo-hide-')), 'hidden.sqlite');
    const left = hidePack(file, dest, hide);
    const after = readDoors(dest);
    expect(left).toBeGreaterThanOrEqual(after.length);
    expect(after.map((d) => d.id)).toEqual(all.filter((d) => !hide.has(d.id)).map((d) => d.id));
    expect(readDoors(file)).toHaveLength(all.length);
  });

  it('handles more doors than one batch and an empty list', () => {
    const all = readDoors(file);
    const dest = join(mkdtempSync(join(tmpdir(), 'geo-hide-')), 'x.sqlite');
    hidePack(file, dest, new Set());
    expect(readDoors(dest)).toHaveLength(all.length);
    const many = new Set(Array.from({ length: 1200 }, (_, i) => 100000 + i));
    hidePack(file, dest, many);
    expect(readDoors(dest)).toHaveLength(all.length);
  });
});
