import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatReport } from '../../src/core/report/format';
import { processReport } from '../../scripts/device-report';
import { sampleReport } from '../report/fixtures';

const tempDir = () => mkdtempSync(join(tmpdir(), 'geo-report-'));

describe('processReport', () => {
  it('writes a json and a markdown file named after the report id', () => {
    const dir = tempDir();
    const result = processReport(formatReport(sampleReport()), dir);
    expect(result.ok).toBe(true);
    expect(existsSync(join(dir, 'cihaz-iphone11-20261022-a1.json'))).toBe(true);
    const md = readFileSync(join(dir, 'cihaz-iphone11-20261022-a1.md'), 'utf8');
    expect(md).toContain('| d1.map-offline | Harita çevrimdışı görünüyor mu | pass |');
    const json = JSON.parse(readFileSync(join(dir, 'cihaz-iphone11-20261022-a1.json'), 'utf8')) as { entries: unknown[] };
    expect(json.entries).toHaveLength(2);
  });

  it('keeps hostile report ids inside the report folder', () => {
    const dir = tempDir();
    const report = sampleReport();
    report.reportId = '../../evil/x';
    const result = processReport(formatReport(report), dir);
    expect(result.ok).toBe(true);
    const files = readdirSync(dir);
    expect(files.every((f) => f.startsWith('cihaz-') && !f.includes('/'))).toBe(true);
    expect(existsSync(join(dir, '..', '..', 'evil'))).toBe(false);
  });

  it('escapes pipes and line breaks in markdown cells', () => {
    const dir = tempDir();
    const report = sampleReport();
    report.entries[1] = { ...report.entries[1]!, note: 'a|b\nc' };
    processReport(formatReport(report), dir);
    const md = readFileSync(join(dir, 'cihaz-iphone11-20261022-a1.md'), 'utf8');
    expect(md).toContain('a\\|b c');
  });

  it('rejects a damaged report without writing files', () => {
    const dir = tempDir();
    const result = processReport('YUKSI-GEO-REPORT v1\nid: x;\n', dir);
    expect(result).toEqual({ ok: false, error: 'TRUNCATED' });
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('device-report command', () => {
  it('exits with 1 and names the error for a truncated report', () => {
    const dir = tempDir();
    const file = join(dir, 'in.txt');
    writeFileSync(file, 'YUKSI-GEO-REPORT v1\nid: x;\n');
    const run = spawnSync('npx', ['tsx', 'scripts/device-report.ts', file], {
      encoding: 'utf8',
      cwd: process.cwd(),
      env: { ...process.env, GEO_REPORT_DIR: dir },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('TRUNCATED');
  });

  it('exits with 0 and reads stdin when the argument is a dash', () => {
    const dir = tempDir();
    const run = spawnSync('npx', ['tsx', 'scripts/device-report.ts', '-'], {
      encoding: 'utf8',
      cwd: process.cwd(),
      input: formatReport(sampleReport()),
      env: { ...process.env, GEO_REPORT_DIR: dir },
    });
    expect(run.status).toBe(0);
    expect(existsSync(join(dir, 'cihaz-iphone11-20261022-a1.json'))).toBe(true);
  });
});
