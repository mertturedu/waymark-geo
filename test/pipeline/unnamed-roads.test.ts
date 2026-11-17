import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { link } from '../../pipeline/build/building-link';
import { loadUnnamedRoads, ROAD_LINK_M } from '../../pipeline/build/unnamed-roads';

const write = (dir: string, name: string, rows: object[]): void => {
  mkdirSync(join(dir, name.split('/')[0] as string), { recursive: true });
  writeFileSync(join(dir, name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
};

describe('loadUnnamedRoads', () => {
  it('adı türetilen yolları atar, kalanları mahalleye göre gruplar ve bağlantı bulur', () => {
    const dir = mkdtempSync(join(tmpdir(), 'unnamed-'));
    write(dir, 'unnamed/99.jsonl', [
      { id: 'w1', lines: [[[30, 40], [30.001, 40]]] },
      { id: 'w2', lines: [[[30.001, 40], [30.002, 40]]] },
      { id: 'w3', lines: [[[31, 41], [31.001, 41]]] },
    ]);
    write(dir, 'street-names/99.jsonl', [{ ways: ['w3'] }]);
    const out = loadUnnamedRoads(dir, '99', (lon) => (lon < 30.5 ? 7 : 8));
    expect(out.roads).toHaveLength(1);
    expect(out.roads[0]?.hood).toBe(7);
    expect(out.roads[0]?.path.length).toBeGreaterThanOrEqual(3);
    const near = link(out.index, { id: 'b', lon: 30.0008, lat: 40.0003, area: 80 }, ROAD_LINK_M);
    expect(near?.component).toBe(0);
    expect(link(out.index, { id: 'far', lon: 30.0008, lat: 40.01, area: 80 }, ROAD_LINK_M)).toBeNull();
  });

  it('dosya yoksa boş döner', () => {
    const dir = mkdtempSync(join(tmpdir(), 'unnamed-'));
    expect(loadUnnamedRoads(dir, '99', () => null).roads).toEqual([]);
  });
});
