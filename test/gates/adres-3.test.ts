import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.YUKSI_GEO_KIYAS = mkdtempSync(join(tmpdir(), 'kiyas-'));

import { adres3Gates } from '../../gates/adres-3';
import { recordMeasure } from '../../tools/compare/measures';

const ctx = { reportDir: mkdtempSync(join(tmpdir(), 'a3-')), repoRoot: mkdtempSync(join(tmpdir(), 'a3r-')), run: async () => ({ code: 0, out: 'Tests: 9 passed, 9 total' }) };
const gate = (id: string) => adres3Gates.find((g) => g.id === id)!;
const groups = (hood: number, wrong: number) => ({ groups: { tümü: { count: 10, hood, district: 90, within30: 80 }, district_wrong: { count: 10, hood: wrong, district: 90, within30: 80 } } });

describe('adres3Gates', () => {
  it('is open until measured', async () => {
    expect((await gate('A3.1').measure(ctx)).status).toBe('open');
    expect((await gate('A3.3').measure(ctx)).status).toBe('open');
  });

  it('judges the wrong district hood share at 95', async () => {
    recordMeasure('a3_new', groups(97, 95));
    expect((await gate('A3.1').measure(ctx)).status).toBe('pass');
    recordMeasure('a3_new', groups(97, 94.9));
    expect((await gate('A3.1').measure(ctx)).status).toBe('fail');
  });

  it('wants an increase over the baseline on both sets', async () => {
    recordMeasure('a3_base', groups(92, 6));
    recordMeasure('a3_new', groups(97, 95));
    recordMeasure('a3_g2a_base', groups(86, 0));
    recordMeasure('a3_g2a_new', groups(95, 0));
    expect((await gate('A3.2').measure(ctx)).status).toBe('pass');
    recordMeasure('a3_g2a_new', groups(86, 0));
    expect((await gate('A3.2').measure(ctx)).status).toBe('fail');
  });

  it('compares with Nominatim and takes the regression gate from the test run', async () => {
    recordMeasure('a3_nominatim', { count: 100, sdk: 98, nominatim: 91 });
    expect((await gate('A3.3').measure(ctx)).status).toBe('pass');
    recordMeasure('a3_nominatim', { count: 100, sdk: 90, nominatim: 91 });
    expect((await gate('A3.3').measure(ctx)).status).toBe('fail');
    expect((await gate('A3.4').measure(ctx)).status).toBe('pass');
  });
});
