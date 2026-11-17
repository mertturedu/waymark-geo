import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GoldenQuery } from '../../scripts/build-address-golden';

const PLATES = ['06', '10', '16', '20', '34', '35', '38', '41', '42', '45', '58', '59'];
const load = (plate: string): GoldenQuery[] => (JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'address-golden', `${plate}.json`), 'utf8')) as { queries: GoldenQuery[] }).queries;
const all = PLATES.flatMap(load);

describe('fixtures/address-golden', () => {
  it.each(PLATES)('has at least three hundred queries for %s with unique ids', (plate) => {
    const queries = load(plate);
    expect(queries.length).toBeGreaterThanOrEqual(300);
    expect(new Set(queries.map((q) => q.id)).size).toBe(queries.length);
    expect(queries.every((q) => q.expect.plate === plate && q.text.trim() !== '')).toBe(true);
    expect(queries.filter((q) => q.category === 'hard').length).toBeGreaterThanOrEqual(10);
  });

  it('holds every category and at least sixty queries in each language over the twelve provinces', () => {
    for (const category of ['full', 'folded', 'typo', 'numbered', 'hide', 'poi', 'lang', 'hard']) expect(all.some((q) => q.category === category)).toBe(true);
    for (const lang of ['en', 'de', 'ru', 'el', 'ar']) expect(all.filter((q) => q.category === 'lang' && q.lang === lang).length).toBeGreaterThanOrEqual(60);
  });

  it('has at least a hundred and twenty places over the twelve provinces', () => {
    expect(all.filter((q) => q.category === 'poi').length).toBeGreaterThanOrEqual(120);
  });

  it('keeps the written street out of every typo query', () => {
    for (const q of all.filter((x) => x.category === 'typo')) expect(q.text).not.toContain(q.expect.streetName as string);
  });

  it('has no private data: only addresses, places and plain text', () => {
    for (const q of all) expect(Object.keys(q.expect).every((k) => ['plate', 'osm', 'number', 'streetName', 'streetNumber', 'kind', 'truth'].includes(k))).toBe(true);
  });
});
