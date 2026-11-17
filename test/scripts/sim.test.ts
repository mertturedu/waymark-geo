import { SIM_CHECKS, runSim, simReport } from '../../scripts/sim';

const result = (check: string, pass: boolean) => ({ check, pass, measured: `ölçüm ${check}`, report: `# ${check}\n\ntablo ${check}\n` });

describe('simReport', () => {
  it('opens with one line per measurement and then the detail of each', () => {
    const text = simReport([result('delivery1', true), result('sparse', false)], '2026-10-24', 'all');
    expect(text).toContain('# Öğrenme simülasyonu 2026-10-24');
    expect(text).toContain('Komşu noktalar: all');
    expect(text).toContain('| delivery1 | ölçüm delivery1 | geçti |');
    expect(text).toContain('| sparse | ölçüm sparse | tutmadı |');
    expect(text.indexOf('| sparse |')).toBeLessThan(text.indexOf('tablo delivery1'));
    expect(text.indexOf('tablo delivery1')).toBeLessThan(text.indexOf('tablo sparse'));
  });

  it('says what it knows when nothing was measured', () => {
    expect(simReport([], '2026-10-24', 'trusted')).toContain('Komşu noktalar: trusted');
  });
});

describe('runSim', () => {
  it('lists the measurements the plan asks for', () => {
    expect(SIM_CHECKS).toEqual(['delivery1', 'delivery3', 'delivery5', 'pin', 'outlier', 'sparse']);
  });

  it('skips a measurement it does not know', async () => {
    expect(await runSim('all', ['nothing'])).toEqual([]);
  });
});
