import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Place } from '../../src/core/address/types';
import { createCorrections } from '../../src/core/learn/corrections';
import { createLearning } from '../../src/core/learn/learning';
import { memoryStore } from '../../src/core/learn/store';
import { parseArgs, runImport } from '../../scripts/corrections';

const place = (houseNumber: string): Place => ({
  id: 'x', label: 'x', components: { province: 'İstanbul', district: 'Kadıköy', neighbourhood: 'Moda', street: 'Gül Sokak', houseNumber }, coordinate: [28.6, 40.7], precision: 'interpolated', approximate: true, source: 'interpolated', confidence: 0.5, region: '34',
});
const KEY = { region: '34', district: 'kadikoy', neighbourhood: 'moda', street: 'gul~sokak', houseNumber: '20' };
const dir = (): string => mkdtempSync(join(tmpdir(), 'geo-corr-'));

async function exported(): Promise<string> {
  const learning = await createLearning({ store: memoryStore(), now: () => 1_700_000_000 });
  await learning.confirm({ place: place('20'), point: [28.66, 40.76], source: 'pin' });
  await learning.confirm({ place: place('22'), point: [28.67, 40.76], source: 'delivery' });
  const file = join(dir(), 'cihaz-1.jsonl');
  writeFileSync(file, learning.exportLines().join('\n') + '\n');
  return file;
}

describe('parseArgs', () => {
  it('reads files and the switches', () => {
    expect(parseArgs(['import', 'a.jsonl', 'b.jsonl', '--approve', '--include-single', '--out', 'x'], '2026-10-24')).toMatchObject({ files: ['a.jsonl', 'b.jsonl'], approve: true, includeSingle: true, outDir: 'x', date: '2026-10-24' });
    expect(parseArgs(['import', 'a.jsonl'], '2026-10-24')).toMatchObject({ approve: false, includeSingle: false });
  });

  it('explains itself when it cannot work', () => {
    expect(parseArgs([])).toContain('usage');
    expect(parseArgs(['merge', 'a'])).toContain('usage');
    expect(parseArgs(['import'])).toContain('dosya');
    expect(parseArgs(['import', 'a', '--out'])).toContain('--out');
    expect(parseArgs(['import', 'a', '--force'])).toContain('--force');
  });
});

describe('runImport', () => {
  it('writes only the report until the review is approved', async () => {
    const file = await exported();
    const out = dir();
    const outcome = runImport({ files: [file], approve: false, includeSingle: false, outDir: join(out, 'c'), reportDir: join(out, 'r'), date: '2026-10-24' });
    expect(outcome).toMatchObject({ accepted: 1, flagged: 1, correctionsPath: null });
    expect(readFileSync(outcome.reportPath, 'utf8')).toContain('1 anahtar kabul');
    expect(outcome.reportPath).toBe(join(out, 'r', 'duzeltme-aykiri-2026-10-24.md'));
    expect(existsSync(join(out, 'c'))).toBe(false);
  });

  it('writes a corrections file after approval that serves the same points', async () => {
    const file = await exported();
    const out = dir();
    const outcome = runImport({ files: [file], approve: true, includeSingle: false, outDir: join(out, 'c'), reportDir: join(out, 'r'), date: '2026-10-24' });
    expect(outcome.correctionsPath).toBe(join(out, 'c', 'corrections-2026-10-24.jsonl'));
    const layer = createCorrections(readFileSync(outcome.correctionsPath as string, 'utf8').split('\n'));
    expect(await layer.lookup(KEY)).toEqual({ coordinate: [28.66, 40.76], trusted: true });
    expect(await layer.lookup({ ...KEY, houseNumber: '22' })).toBeNull();
  });

  it('takes a lone delivery only when asked', async () => {
    const file = await exported();
    const out = dir();
    const outcome = runImport({ files: [file], approve: true, includeSingle: true, outDir: join(out, 'c'), reportDir: join(out, 'r'), date: '2026-10-24' });
    expect(outcome.accepted).toBe(2);
  });

  it('refuses a file that does not exist before writing anything', () => {
    const out = dir();
    expect(() => runImport({ files: [join(out, 'yok.jsonl')], approve: true, includeSingle: false, outDir: join(out, 'c'), reportDir: join(out, 'r'), date: 'd' })).toThrow('dosya yok');
    expect(existsSync(join(out, 'r'))).toBe(false);
  });
});

describe('the command', () => {
  it('prints where it wrote and exits with 2 on bad arguments', () => {
    const bad = spawnSync('npx', ['tsx', 'scripts/corrections.ts', 'import'], { encoding: 'utf8' });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('dosya');
    const missing = spawnSync('npx', ['tsx', 'scripts/corrections.ts', 'import', '/nonexistent/x.jsonl'], { encoding: 'utf8' });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('dosya yok');
  });

  it('writes the report and the corrections file in one go', async () => {
    const file = await exported();
    const out = dir();
    const run = spawnSync('npx', ['tsx', 'scripts/corrections.ts', 'import', file, '--approve', '--out', join(out, 'c')], { encoding: 'utf8', env: { ...process.env, GEO_REPORT_DIR: join(out, 'r') } });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('düzeltme dosyası:');
    expect(run.stdout).toContain('1 anahtar kabul');
  });

  it('says when it wrote no corrections', async () => {
    const file = await exported();
    const out = dir();
    const run = spawnSync('npx', ['tsx', 'scripts/corrections.ts', 'import', file], { encoding: 'utf8', env: { ...process.env, GEO_REPORT_DIR: join(out, 'r') } });
    expect(run.stdout).toContain('--approve');
  });
});
