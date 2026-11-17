import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.YUKSI_GEO_KIYAS = mkdtempSync(join(tmpdir(), 'kiyas-'));

import { adres2Gates } from '../../gates/adres-2';
import { recordMeasure } from '../../tools/compare/measures';

const ctx = { reportDir: mkdtempSync(join(tmpdir(), 'a2-')), repoRoot: mkdtempSync(join(tmpdir(), 'a2r-')), run: async () => ({ code: 0, out: 'Tests: 5 passed, 5 total' }) };
const gate = (id: string) => adres2Gates.find((g) => g.id === id)!;
const all = (value: number) => Object.fromEntries(['province', 'district', 'hood', 'street', 'number', 'floor', 'door', 'block'].map((c) => [c, value]));

describe('adres2Gates', () => {
  it('is open until measured', async () => {
    expect((await gate('A2.1').measure(ctx)).status).toBe('open');
    expect((await gate('A2.3').measure(ctx)).status).toBe('open');
  });

  it('judges F1 by the overall mean, the name components and the unit components', async () => {
    recordMeasure('a2_heldout', { count: 100, f1: all(97), falseDrops: 0, libpostal: all(40) });
    expect((await gate('A2.1').measure(ctx)).status).toBe('pass');
    recordMeasure('a2_heldout', { count: 100, f1: { ...all(97), street: 89 }, falseDrops: 0, libpostal: all(40) });
    expect((await gate('A2.1').measure(ctx)).status).toBe('fail');
    recordMeasure('a2_heldout', { count: 100, f1: { ...all(97), block: 94 }, falseDrops: 0, libpostal: all(40) });
    expect((await gate('A2.1').measure(ctx)).status).toBe('fail');
  });

  it('requires the SDK to be at least as good as libpostal on every component', async () => {
    recordMeasure('a2_heldout', { count: 100, f1: all(97), falseDrops: 0, libpostal: all(40) });
    expect((await gate('A2.2').measure(ctx)).status).toBe('pass');
    recordMeasure('a2_heldout', { count: 100, f1: all(97), falseDrops: 0, libpostal: { ...all(40), hood: 98 } });
    expect((await gate('A2.2').measure(ctx)).status).toBe('fail');
  });

  it('allows no false drops and judges the attributable error and Hermes', async () => {
    recordMeasure('a2_heldout', { count: 100, f1: all(97), falseDrops: 1 });
    expect((await gate('A2.4').measure(ctx)).status).toBe('fail');
    recordMeasure('a2_attrib', { total: 100, failedShare: 14, attributableShare: 2.5 });
    expect((await gate('A2.3').measure(ctx)).status).toBe('pass');
    recordMeasure('a2_attrib', { total: 100, failedShare: 14, attributableShare: 3.3 });
    expect((await gate('A2.3').measure(ctx)).status).toBe('fail');
    recordMeasure('a2_hermes', { total: 3000, different: 0, p95: 1 });
    expect((await gate('A2.5').measure(ctx)).status).toBe('pass');
    recordMeasure('a2_hermes', { total: 3000, different: 2, p95: 1 });
    expect((await gate('A2.5').measure(ctx)).status).toBe('fail');
  });

  it('takes the regression gate from the test run', async () => {
    expect((await gate('A2.6').measure(ctx)).status).toBe('pass');
    expect((await gate('A2.6').measure({ ...ctx, run: async () => ({ code: 1, out: '' }) })).status).toBe('fail');
  });
});
