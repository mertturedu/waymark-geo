import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Gate } from './engine';
import type { DeviceReport } from '../src/core/report/types';

const AUTO_IDS = ['sdk.map-open', 'sdk.offline-search', 'sdk.rot-default-tilt'];
const PERF_IDS = ['sdk.perf-map-open', 'sdk.perf-pan', 'sdk.perf-js-gap', 'sdk.perf-memory'];
const THRESHOLDS: Record<string, { lines: number; branches: number }> = {
  'src/core/**/*.ts': { lines: 90, branches: 85 },
  'src/native/logic/**/*.ts': { lines: 90, branches: 80 },
  'src/native/map/**/*.ts': { lines: 90, branches: 80 },
};

export const uploadedReports = (reportDir: string): DeviceReport[] => {
  const dir = join(reportDir, 'cihaz');
  if (!existsSync(dir)) return [];
  const out: DeviceReport[] = [];
  for (const name of readdirSync(dir).filter((file) => file.startsWith('cihaz-') && file.endsWith('.json'))) {
    try {
      const report = JSON.parse(readFileSync(join(dir, name), 'utf8')) as DeviceReport;
      if (Array.isArray(report.entries)) out.push(report);
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
};

export function thresholdsHold(config: string): string[] {
  const missing: string[] = [];
  for (const [path, want] of Object.entries(THRESHOLDS)) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const match = new RegExp(`'${escaped}':\\s*\\{\\s*lines:\\s*(\\d+),\\s*branches:\\s*(\\d+)\\s*\\}`).exec(config);
    if (!match || Number(match[1]) < want.lines || Number(match[2]) < want.branches) missing.push(path);
  }
  return missing;
}

export const fix0Gates: Gate[] = [
  {
    id: 'KF0.1',
    phase: 0,
    title: 'npm run verify yeşil (tip, lint, testler ve kapsam)',
    kind: 'auto',
    threshold: 'çıkış kodu 0',
    async measure({ run }) {
      const result = await run('npm', ['run', 'verify']);
      return result.code === 0 ? { status: 'pass', measured: 'çıkış kodu 0' } : { status: 'fail', measured: `çıkış kodu ${result.code}: ${result.out.trim().split('\n').slice(-3).join(' / ')}` };
    },
  },
  {
    id: 'KF0.2',
    phase: 0,
    title: 'Kapsam eşikleri core, native/logic ve native/map için tanımlı ve gevşetilmemiş',
    kind: 'auto',
    threshold: 'core 90/85, native/logic 90/80, native/map 90/80',
    async measure({ repoRoot }) {
      const missing = thresholdsHold(readFileSync(join(repoRoot, 'jest.config.js'), 'utf8'));
      return missing.length === 0 ? { status: 'pass', measured: 'üç eşik de yerinde' } : { status: 'fail', measured: `eksik ya da düşük: ${missing.join(', ')}` };
    },
  },
  {
    id: 'KF0.3',
    phase: 0,
    title: 'Otomatik hat: kayıtlar dokunmadan koştu ve rapor sunucuya geldi',
    kind: 'device',
    threshold: `${AUTO_IDS.join(', ')} geçti`,
    async measure({ reportDir }) {
      const report = uploadedReports(reportDir).find((r) => AUTO_IDS.every((id) => r.entries.some((e) => e.id === id)));
      if (!report) return { status: 'open', measured: 'otomatik hattan gelen rapor yok' };
      const failed = AUTO_IDS.filter((id) => report.entries.find((e) => e.id === id)?.outcome !== 'pass');
      return failed.length === 0 ? { status: 'pass', measured: `${report.reportId}: üç kayıt geçti` } : { status: 'fail', measured: `${report.reportId}: geçmeyen ${failed.join(', ')}` };
    },
  },
  {
    id: 'KF0.4',
    phase: 0,
    title: 'Temel ölçüm: stil tablosu, mahalle sayısı ve cihaz performans değerleri dolu',
    kind: 'device',
    threshold: 'fix-0-temel.md + 4 performans kaydı değerli',
    async measure({ reportDir }) {
      const file = join(reportDir, 'fix-0-temel.md');
      if (!existsSync(file)) return { status: 'fail', measured: 'fix-0-temel.md yok' };
      const text = readFileSync(file, 'utf8');
      if (!text.includes('| 81 |') || !text.includes('Mahalle adları')) return { status: 'fail', measured: 'temel ölçüm dosyası eksik' };
      const report = uploadedReports(reportDir).find((r) => PERF_IDS.every((id) => r.entries.some((e) => e.id === id)));
      if (!report) return { status: 'open', measured: 'performans raporu yok' };
      const empty = PERF_IDS.filter((id) => !report.entries.find((e) => e.id === id)?.value);
      return empty.length === 0 ? { status: 'pass', measured: `${report.reportId}: ${PERF_IDS.map((id) => `${id.slice(9)} ${report.entries.find((e) => e.id === id)!.value}`).join(', ')}` } : { status: 'fail', measured: `boş değer: ${empty.join(', ')}` };
    },
  },
  {
    id: 'KF0.5',
    phase: 0,
    title: 'Temizlik denetimi: SDK reposunda yapay zekâ izi yok',
    kind: 'auto',
    threshold: 'çıktı boş',
    async measure({ run }) {
      const result = await run('sh', ['-c', 'cd .. && node tools/geo-clean-check.mjs yuksi-geo']);
      return result.code === 0 && result.out.trim() === '' ? { status: 'pass', measured: 'temiz' } : { status: 'fail', measured: result.out.trim().split('\n').slice(0, 3).join(' / ') || `çıkış kodu ${result.code}` };
    },
  },
];
