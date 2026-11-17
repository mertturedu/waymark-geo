import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { textGolden } from '../../example/src/device-test/tests/text-golden';

describe('text.golden device test', () => {
  it('is listed in the registry as an automatic test', () => {
    const registry = readFileSync(join(process.cwd(), 'example/src/device-test/registry.ts'), 'utf8');
    expect(registry.match(/\btextGolden\b/g)).toHaveLength(2);
    expect(textGolden).toMatchObject({ id: 'text.golden', kind: 'auto' });
  });

  it('passes in Node and writes what the report needs', async () => {
    const result = await textGolden.run({ packServerUrl: '', packsDir: '', reportDir: '', log: () => undefined });
    expect(result.outcome).toBe('pass');
    expect(result.value).toMatch(/^(\d+)\/\1$/);
    expect(result.unit).toBe('vaka');
    expect(result.note).toMatch(/Unicode \d+ kontrol, 0 fark; 3000 çağrıda p99 [\d.]+ ms, en uzun [\d.]+ ms/);
  }, 60_000);
});
