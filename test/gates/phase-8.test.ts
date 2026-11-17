import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGates, type GateContext } from '../../gates/engine';
import { phase8Gates, RECHECK } from '../../gates/phase-8';

const world = () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'g8r-'));
  const reportDir = mkdtempSync(join(tmpdir(), 'g8-'));
  const calls: { cmd: string; args: string[] }[] = [];
  const ctx: GateContext = { repoRoot, reportDir, run: async (cmd, args) => (calls.push({ cmd, args }), { code: 0, out: '{"measured":"tamam"}' }) };
  return { repoRoot, reportDir, ctx, calls };
};

const release = (repoRoot: string, tag: string, sources: object, when?: Date): void => {
  const dir = join(repoRoot, 'dist', 'releases', tag);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'summary.json'), '{}');
  writeFileSync(join(dir, 'sources.json'), JSON.stringify(sources));
  if (when) utimesSync(join(dir, 'summary.json'), when, when);
};

const fresh = { osmFile: 'x', osmMd5: 'x', osmTimestamp: '2026-10-28T20:00:00Z', tilesBuild: '20261029', tilesOsmTime: '2026-10-29T04:00:00Z' };

describe('phase 8 gates', () => {
  it('lists the gates in order and lets only the device gate stay open', () => {
    expect(phase8Gates.map((g) => g.id)).toEqual(['K8.1', 'K8.2', 'K8.3', 'K8.4', 'K8.5', 'K8.6', 'K8.7', 'K8.8']);
    expect(phase8Gates.filter((g) => g.allowOpen).map((g) => g.id)).toEqual(['K8.7']);
  });

  it('passes freshness for a recent release and fails an old one', async () => {
    const { repoRoot, ctx } = world();
    release(repoRoot, '20261028.20261029', fresh, new Date('2026-10-30T10:00:00Z'));
    const k81 = phase8Gates.find((g) => g.id === 'K8.1') as (typeof phase8Gates)[number];
    expect((await k81.measure(ctx)).status).toBe('pass');
    release(repoRoot, '20261110.20261111', fresh, new Date('2026-11-10T10:00:00Z'));
    expect((await k81.measure(ctx)).status).toBe('fail');
  });

  it('needs a previous release and a report for the regression gate, and accepts a written decision', async () => {
    const { repoRoot, reportDir, ctx } = world();
    const k82 = phase8Gates.find((g) => g.id === 'K8.2') as (typeof phase8Gates)[number];
    release(repoRoot, '20261020.20261022', fresh);
    expect((await k82.measure(ctx)).status).toBe('fail');
    release(repoRoot, '20261028.20261029', fresh);
    expect((await k82.measure(ctx)).measured).toContain('değişim raporu yok');
    writeFileSync(join(reportDir, 'faz-8-degisim-20261028.20261029.md'), 'Gerileme kapısı (K8.2): GEÇMEDİ');
    expect((await k82.measure(ctx)).status).toBe('fail');
    mkdirSync(join(reportDir, 'faz-8-kararlar'));
    writeFileSync(join(reportDir, 'faz-8-kararlar', '20261028.20261029.md'), 'onaylandı');
    expect((await k82.measure(ctx)).status).toBe('pass');
  });

  it('re-runs every earlier measurement for the new release', async () => {
    const { ctx, calls } = world();
    const [k83] = await runGates(phase8Gates.filter((g) => g.id === 'K8.3'), ctx);
    expect(calls).toHaveLength(RECHECK.length);
    expect(k83?.status).toBe('pass');
  });

  it('leaves the device gate open without a Release report', async () => {
    const { ctx } = world();
    const [k87] = await runGates(phase8Gates.filter((g) => g.id === 'K8.7'), ctx);
    expect(k87?.status).toBe('open');
  });
});
