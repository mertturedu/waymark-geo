import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGolden, type GoldenFile } from './helpers/golden';

const golden = JSON.parse(readFileSync(join(process.cwd(), 'fixtures/text-golden.json'), 'utf8')) as GoldenFile;

describe('fixtures/text-golden.json', () => {
  it('holds at least 1500 cases with unique ids', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(1500);
    expect(new Set(golden.cases.map((c) => c.id)).size).toBe(golden.cases.length);
  });

  it('has at least 100 cases in each of the six languages', () => {
    const counts = new Map<string, number>();
    for (const c of golden.cases) counts.set(c.lang, (counts.get(c.lang) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual(['ar', 'de', 'el', 'en', 'ru', 'tr']);
    for (const count of counts.values()) expect(count).toBeGreaterThanOrEqual(100);
  });

  it('has real street names from each of the twelve priority provinces', () => {
    const provinces = new Map<string, Set<string>>();
    for (const c of golden.cases) if (c.source === 'osm') provinces.set(c.province, (provinces.get(c.province) ?? new Set()).add(c.expect.street));
    expect([...provinces.keys()].sort()).toEqual(['06', '10', '16', '20', '34', '35', '38', '41', '42', '45', '58', '59']);
    for (const streets of provinces.values()) expect(streets.size).toBeGreaterThanOrEqual(50);
  });

  it('has hand written hard cases and says how many generated ones it left out', () => {
    expect(golden.cases.filter((c) => c.source === 'hand').length).toBeGreaterThanOrEqual(120);
    expect(golden.excluded.generated).toBeGreaterThan(0);
    expect(golden.excluded.generated).toBeLessThan(golden.cases.length * 0.05);
  });

  it('is read correctly in every case (K1.1)', () => {
    const result = runGolden(golden.cases);
    expect(result.failed).toEqual([]);
  });
});
