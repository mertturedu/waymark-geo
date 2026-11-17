import type { Gate } from './engine';
import type { DeviceReport } from '../src/core/report/types';
import { uploadedReports } from './fix-0';
import { isSimulator } from './fix-1';

const UNIT_FILES = [
  'test/map/region-window.test.ts',
  'test/map/style-budget.test.ts',
  'test/map/poi-glyphs.test.ts',
  'test/react/use-map-style.test.tsx',
  'test/address/search-memory.test.ts',
  'test/packs/store.test.ts',
  'test/pipeline/overture.test.ts',
  'test/scripts/make-alt-packs.test.ts',
];

export const OPEN_GAIN = 30;
export const PAN_GAIN = 30;
export const PAN_MAX_MS = 700;
export const JS_GAP_MAX_MS = 100;

export type Gains = { open: number; pan: number; panMs: number };

export function gainsOf(note: string): Gains | null {
  const open = /açılış kazancı (-?\d+)%/.exec(note)?.[1];
  const pan = /kaydırma kazancı (-?\d+)%/.exec(note)?.[1];
  const ms = /pencereli: \d+ katman, açılış \d+ ms, kaydırma p95 (\d+) ms/.exec(note)?.[1];
  return open === undefined || pan === undefined || ms === undefined ? null : { open: Number(open), pan: Number(pan), panMs: Number(ms) };
}

const entryOf = (report: DeviceReport, id: string) => report.entries.find((entry) => entry.id === id);

const latestWith = (reports: DeviceReport[], ids: string[]): DeviceReport | undefined => reports.find((report) => !isSimulator(report) && ids.every((id) => entryOf(report, id)));

export const fix3Gates: Gate[] = [
  {
    id: 'KF3.1',
    phase: 3,
    title: 'F3 birim testleri: görünüm penceresi, stil bütçesi, eşdeğerlik, adres paketi belleği, veri hattı',
    kind: 'auto',
    threshold: 'çıkış kodu 0',
    async measure({ run }) {
      const result = await run('npx', ['jest', ...UNIT_FILES]);
      const tests = /Tests:\s+(.*)/.exec(result.out)?.[1] ?? '';
      return result.code === 0 ? { status: 'pass', measured: tests || 'geçti' } : { status: 'fail', measured: tests || result.out.trim().split('\n').slice(-3).join(' / ') };
    },
  },
  {
    id: 'KF3.2',
    phase: 3,
    title: 'Pencereli stil, 7 il kurulu: açılış ve kaydırma kazancı',
    kind: 'device',
    threshold: `açılış en az %${OPEN_GAIN}, kaydırma p95 en az %${PAN_GAIN} kısa ve en çok ${PAN_MAX_MS} ms`,
    async measure({ reportDir }) {
      const report = latestWith(uploadedReports(reportDir), ['sdk.perf-region-window']);
      if (!report) return { status: 'open', measured: 'cihaz raporu yok' };
      const entry = entryOf(report, 'sdk.perf-region-window')!;
      const gains = gainsOf(entry.note ?? '');
      if (!gains) return { status: 'fail', measured: `${report.reportId}: rapor okunamadı` };
      const ok = gains.open >= OPEN_GAIN && gains.pan >= PAN_GAIN && gains.panMs <= PAN_MAX_MS;
      return { status: ok ? 'pass' : 'fail', measured: `${report.reportId}: açılış ${gains.open}%, kaydırma ${gains.pan}% (p95 ${gains.panMs} ms)` };
    },
  },
  {
    id: 'KF3.3',
    phase: 3,
    title: 'İl geçişinde stil bir kez yüklenir ve karolar çizilir; harita turu gerilemez',
    kind: 'device',
    threshold: 'sdk.region-switch geçti',
    async measure({ reportDir }) {
      const report = latestWith(uploadedReports(reportDir), ['sdk.region-switch']);
      if (!report) return { status: 'open', measured: 'cihaz raporu yok' };
      const entry = entryOf(report, 'sdk.region-switch')!;
      return entry.outcome === 'pass' ? { status: 'pass', measured: `${report.reportId}: ${entry.note ?? ''}` } : { status: 'fail', measured: `${report.reportId}: ${entry.note ?? entry.outcome}` };
    },
  },
  {
    id: 'KF3.4',
    phase: 3,
    title: 'Eski harita turu (sdk.map-*) ve JS boşluğu: gerileme yok',
    kind: 'device',
    threshold: `sdk.map-* ve sdk.rot-* geçti, sdk.perf-js-gap en çok ${JS_GAP_MAX_MS} ms`,
    async measure({ reportDir }) {
      const reports = uploadedReports(reportDir).filter((report) => !isSimulator(report));
      const report = reports.find((candidate) => candidate.entries.filter((entry) => entry.id.startsWith('sdk.map-')).length >= 8 && entryOf(candidate, 'sdk.perf-js-gap'));
      if (!report) return { status: 'open', measured: 'harita turu raporu yok' };
      const failed = report.entries.filter((entry) => /^sdk\.(map|rot)-/.test(entry.id) && entry.outcome === 'fail').map((entry) => entry.id);
      const gap = Number(entryOf(report, 'sdk.perf-js-gap')?.value ?? NaN);
      if (failed.length > 0) return { status: 'fail', measured: `${report.reportId}: geçmeyen ${failed.join(', ')}` };
      if (!(gap <= JS_GAP_MAX_MS)) return { status: 'fail', measured: `${report.reportId}: JS boşluğu ${entryOf(report, 'sdk.perf-js-gap')?.value ?? '-'} ms` };
      return { status: 'pass', measured: `${report.reportId}: harita turu geçti, JS boşluğu ${gap} ms` };
    },
  },
  {
    id: 'KF3.5',
    phase: 3,
    title: 'Temizlik denetimi',
    kind: 'auto',
    threshold: 'çıktı boş',
    async measure(ctx) {
      const result = await ctx.run('sh', ['-c', 'cd .. && node tools/geo-clean-check.mjs yuksi-geo']);
      return result.code === 0 && result.out.trim() === '' ? { status: 'pass', measured: 'temiz' } : { status: 'fail', measured: result.out.trim().split('\n').slice(0, 3).join(' / ') || `çıkış kodu ${result.code}` };
    },
  },
];
