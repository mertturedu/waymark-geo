import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMutationRun, markSkipped, MUTATION_SKIPPED, parseFixArg } from '../../gates/cli';
import { fix0Gates, thresholdsHold, uploadedReports } from '../../gates/fix-0';

const gate = (id: string) => fix0Gates.find((g) => g.id === id)!;
const entry = (id: string, outcome: 'pass' | 'fail' | 'info', value?: string) => ({ id, title: id, kind: 'auto', outcome, ...(value ? { value } : {}) });

const folder = (reports: object[], baseline?: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'fix0-'));
  mkdirSync(join(dir, 'cihaz'));
  reports.forEach((report, index) => writeFileSync(join(dir, 'cihaz', `cihaz-r${index}.json`), JSON.stringify(report)));
  writeFileSync(join(dir, 'cihaz', 'cihaz-bozuk.json'), '{');
  if (baseline) writeFileSync(join(dir, 'fix-0-temel.md'), baseline);
  return dir;
};

const ctx = (reportDir: string) => ({ reportDir, repoRoot: '/', run: async () => ({ code: 0, out: '' }) });

describe('fix 0 gates', () => {
  it('reads the --fix argument', () => {
    expect(parseFixArg(['--fix', '0'])).toBe(0);
    expect(parseFixArg(['--fix', 'x'])).toBeNull();
    expect(parseFixArg([])).toBeNull();
  });

  it('notices a loosened or missing coverage threshold', () => {
    const good = "'src/core/**/*.ts': { lines: 90, branches: 85 },\n'src/native/logic/**/*.ts': { lines: 90, branches: 80 },\n'src/native/map/**/*.ts': { lines: 92, branches: 80 },";
    expect(thresholdsHold(good)).toEqual([]);
    expect(thresholdsHold(good.replace('branches: 85', 'branches: 70'))).toEqual(['src/core/**/*.ts']);
    expect(thresholdsHold("'src/core/**/*.ts': { lines: 90, branches: 85 },")).toEqual(['src/native/logic/**/*.ts', 'src/native/map/**/*.ts']);
  });

  it('skips broken report files and sorts the newest first', () => {
    const dir = folder([{ reportId: 'a', createdAt: '2026-11-01', entries: [] }, { reportId: 'b', createdAt: '2026-11-02', entries: [] }]);
    expect(uploadedReports(dir).map((r) => r.reportId)).toEqual(['b', 'a']);
  });

  it('opens, passes and fails the automatic line gate', async () => {
    expect((await gate('KF0.3').measure(ctx(folder([])))).status).toBe('open');
    const ok = { reportId: 'r', createdAt: '1', entries: ['sdk.map-open', 'sdk.offline-search', 'sdk.rot-default-tilt'].map((id) => entry(id, 'pass')) };
    expect((await gate('KF0.3').measure(ctx(folder([ok])))).status).toBe('pass');
    const bad = { ...ok, entries: [...ok.entries.slice(0, 2), entry('sdk.rot-default-tilt', 'fail')] };
    expect((await gate('KF0.3').measure(ctx(folder([bad])))).status).toBe('fail');
  });

  it('needs the baseline file and filled performance values', async () => {
    const perf = { reportId: 'p', createdAt: '1', entries: ['sdk.perf-map-open', 'sdk.perf-pan', 'sdk.perf-js-gap', 'sdk.perf-memory'].map((id) => entry(id, 'info', '12')) };
    expect((await gate('KF0.4').measure(ctx(folder([perf])))).status).toBe('fail');
    expect((await gate('KF0.4').measure(ctx(folder([], '| 81 |\nMahalle adları')))).status).toBe('open');
    expect((await gate('KF0.4').measure(ctx(folder([perf], '| 81 |\nMahalle adları')))).status).toBe('pass');
    const empty = { ...perf, entries: [...perf.entries.slice(0, 3), entry('sdk.perf-memory', 'info')] };
    expect((await gate('KF0.4').measure(ctx(folder([empty], '| 81 |\nMahalle adları')))).status).toBe('fail');
  });

  it('fails the clean check on any output', async () => {
    const dirty = { reportDir: '/', repoRoot: '/', run: async () => ({ code: 0, out: 'yuksi-geo/NOTES.md' }) };
    expect((await gate('KF0.5').measure(dirty)).status).toBe('fail');
    expect((await gate('KF0.5').measure(ctx('/'))).status).toBe('pass');
  });
});

describe('skipping mutation runs', () => {
  it('knows the mutation commands', () => {
    expect(isMutationRun('npm', ['run', 'mutation'])).toBe(true);
    expect(isMutationRun('npx', ['stryker', 'run', 'stryker.route.config.json'])).toBe(true);
    expect(isMutationRun('npm', ['run', 'verify'])).toBe(false);
    expect(isMutationRun('npx', ['tsx', 'scripts/measure-route.ts'])).toBe(false);
  });

  it('turns a skipped mutation gate into an open gate', () => {
    const base = { id: 'K1.4', title: 't', kind: 'auto' as const, threshold: '80', allowOpen: false };
    const out = markSkipped([
      { ...base, status: 'fail', measured: `mutasyon ${MUTATION_SKIPPED}; kapsam eşikleri geçti` },
      { ...base, id: 'K1.5', status: 'pass', measured: '98,48' },
    ]);
    expect(out.map((r) => r.status)).toEqual(['open', 'pass']);
    expect(out[0]!.measured).toMatch(/mutasyon atlandı/);
  });
});
