import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AUTO_IDS, DEFERRED_IDS, EXTRA_IDS, INFO_IDS, OFFLINE_IDS, QUESTION_IDS, RESTART_IDS } from '../../example/src/sdk-test/ids';

const root = join(__dirname, '../../example/src/sdk-test');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? sources(join(dir, name)) : name.endsWith('.ts') || name.endsWith('.tsx') ? [join(dir, name)] : []));
}

describe('SDK device test ids', () => {
  const text = sources(root).map((f) => readFileSync(f, 'utf8')).join('\n');

  it.each([...AUTO_IDS, ...EXTRA_IDS, ...RESTART_IDS, ...INFO_IDS, ...QUESTION_IDS, ...DEFERRED_IDS])('%s exists in the example app', (id) => {
    expect(text).toContain(`'${id}'`);
  });

  it.each(OFFLINE_IDS)('%s is defined or derived from an existing test', (id) => {
    const derived = `'sdk.${id.slice(4)}'`;
    expect(text.includes(`'${id}'`) || text.includes(derived)).toBe(true);
  });

  it('has each airplane-mode id once and under the off. prefix', () => {
    expect(new Set(OFFLINE_IDS).size).toBe(OFFLINE_IDS.length);
    expect(OFFLINE_IDS.every((id) => id.startsWith('off.'))).toBe(true);
  });

  it('lists every test the app defines', () => {
    const defined = [...text.matchAll(/'(sdk\.[a-z0-9-]+)'/g)].map((m) => m[1] as string);
    const known = new Set([...AUTO_IDS, ...EXTRA_IDS, ...RESTART_IDS, ...INFO_IDS, ...QUESTION_IDS, ...DEFERRED_IDS]);
    expect([...new Set(defined)].filter((id) => !known.has(id))).toEqual([]);
  });

  it('has no id twice across the lists', () => {
    const all = [...AUTO_IDS, ...EXTRA_IDS, ...RESTART_IDS, ...INFO_IDS, ...QUESTION_IDS, ...DEFERRED_IDS];
    expect(new Set(all).size).toBe(all.length);
  });
});
