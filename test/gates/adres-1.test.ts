import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.YUKSI_GEO_KIYAS = mkdtempSync(join(tmpdir(), 'kiyas-'));

import { adres1Gates } from '../../gates/adres-1';
import { measuresFile, readMeasures, recordMeasure } from '../../tools/compare/measures';

describe('measures', () => {
  it('keeps earlier keys when a new one is recorded', () => {
    const before = readMeasures();
    recordMeasure('test_key', { a: 1 });
    expect(readMeasures()).toMatchObject({ ...before, test_key: { a: 1 } });
    expect(measuresFile()).toContain('faz1.json');
  });
});

describe('adres1Gates', () => {
  const ctx = { reportDir: mkdtempSync(join(tmpdir(), 'a1-')), repoRoot: mkdtempSync(join(tmpdir(), 'a1r-')), run: async () => ({ code: 0, out: '' }) };
  const gate = (id: string) => adres1Gates.find((g) => g.id === id)!;

  it('judges the speed gate from recorded records and seconds', async () => {
    recordMeasure('a1_1', { records: 10_000, seconds: 290 });
    expect((await gate('A1.1').measure(ctx)).status).toBe('pass');
    recordMeasure('a1_1', { records: 9_000, seconds: 290 });
    expect((await gate('A1.1').measure(ctx)).status).toBe('fail');
    recordMeasure('a1_1', { records: 10_000, seconds: 4000 });
    expect((await gate('A1.1').measure(ctx)).status).toBe('fail');
  });

  it('judges the Nominatim gate on the total and on every province', async () => {
    recordMeasure('a1_2', { count: 900, within30: 89, per: { '34': 91, '16': 86 } });
    expect((await gate('A1.2').measure(ctx)).status).toBe('pass');
    recordMeasure('a1_2', { count: 900, within30: 89, per: { '34': 95, '16': 80 } });
    expect((await gate('A1.2').measure(ctx)).status).toBe('fail');
  });

  it('judges the mini world gate on seconds', async () => {
    recordMeasure('a1_5', { seconds: 594 });
    expect((await gate('A1.5').measure(ctx)).status).toBe('pass');
    recordMeasure('a1_5', { seconds: 700 });
    expect((await gate('A1.5').measure(ctx)).status).toBe('fail');
  });
});
