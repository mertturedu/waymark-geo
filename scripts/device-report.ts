import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseReport } from '../src/core/report/parse';
import type { DeviceReport, ReportError } from '../src/core/report/types';

export const defaultReportDir = (): string => process.env.GEO_REPORT_DIR ?? join(homedir(), 'Desktop', 'yuksi-geo-raporlar');

const safeName = (id: string): string => id.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');

const cell = (value: string | number | undefined): string => String(value ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

const markdown = (report: DeviceReport): string => {
  const head = [
    `# Cihaz raporu ${report.reportId}`,
    '',
    `- Tarih: ${report.createdAt}`,
    `- Cihaz: ${report.device.model}, ${report.device.os}${report.device.memoryMB ? `, ${report.device.memoryMB} MB` : ''}`,
    `- SDK: ${report.sdk.version}, veri ${report.sdk.dataVersion ?? '-'}, ${report.sdk.build}`,
    '',
    '| id | Başlık | Sonuç | Değer | Birim | Eşik | Not |',
    '|---|---|---|---|---|---|---|',
  ];
  const rows = report.entries.map(
    (e) => `| ${cell(e.id)} | ${cell(e.title)} | ${e.outcome} | ${cell(e.value)} | ${cell(e.unit)} | ${cell(e.threshold)} | ${cell(e.note)} |`,
  );
  return [...head, ...rows, ''].join('\n');
};

export type ProcessResult = { ok: true; jsonPath: string; mdPath: string } | { ok: false; error: ReportError };

export function processReport(text: string, reportDir: string): ProcessResult {
  const parsed = parseReport(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  mkdirSync(reportDir, { recursive: true });
  const base = join(reportDir, `cihaz-${safeName(parsed.report.reportId)}`);
  writeFileSync(`${base}.json`, JSON.stringify(parsed.report, null, 2) + '\n');
  writeFileSync(`${base}.md`, markdown(parsed.report));
  return { ok: true, jsonPath: `${base}.json`, mdPath: `${base}.md` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = process.argv[2];
  if (!source) {
    console.error('usage: npm run device-report -- <file | ->');
    process.exit(2);
  }
  const text = readFileSync(source === '-' ? 0 : source, 'utf8');
  const result = processReport(text, defaultReportDir());
  if (!result.ok) {
    console.error(`report rejected: ${result.error}`);
    process.exit(1);
  }
  console.log(result.jsonPath);
  console.log(result.mdPath);
}
