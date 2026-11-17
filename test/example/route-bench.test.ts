import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { p95, seededSnaps } from '../../example/src/device-test/route-bench-helpers';

describe('route.bench device test', () => {
  it('is listed in the registry', () => {
    const registry = readFileSync(join(process.cwd(), 'example/src/device-test/registry.ts'), 'utf8');
    expect(registry.match(/\brouteBench\b/g)).toHaveLength(2);
    expect(readFileSync(join(process.cwd(), 'example/src/device-test/tests/route-bench.ts'), 'utf8')).toContain("id: 'route.bench'");
  });

  it('draws the same stops for the same seed and keeps them on the edge', () => {
    const pack = { edges: { count: 3, length: new Float64Array([10, 20, 30]) } } as never;
    const a = seededSnaps(pack, 7);
    const b = seededSnaps(pack, 7);
    for (let i = 0; i < 50; i++) {
      const x = a();
      expect(b()).toEqual(x);
      expect(x.edge).toBeGreaterThanOrEqual(0);
      expect(x.edge).toBeLessThan(3);
      expect(x.offsetM).toBeLessThanOrEqual([10, 20, 30][x.edge] as number);
    }
  });

  it('reads the 95th percentile', () => {
    expect(p95([])).toBe(0);
    expect(p95([5])).toBe(5);
    expect(p95(Array.from({ length: 100 }, (_, i) => 100 - i))).toBe(96);
  });
});
