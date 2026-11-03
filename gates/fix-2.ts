import type { Gate } from './engine';
import type { DeviceReport } from '../src/core/report/types';
import { uploadedReports } from './fix-0';
import { deviceGate, isIos27, isSimulator } from './fix-1';

const UNIT_FILES = ['test/packs/region.test.ts', 'test/packs/lifecycle.test.ts', 'test/geo/create-geo.test.ts', 'test/native/logic.test.ts', 'test/native/size.test.ts', 'test/native/location.test.ts', 'test/map/location-region.test.ts', 'test/react', 'test/i18n', 'test/example/connection-switch.test.ts'];
const IDS = ['sdk.auto-location', 'sdk.cellular-consent', 'sdk.locate-cycle'];

export const isAndroid = (report: DeviceReport): boolean => report.device.os.startsWith('Android');

export const fix2Gates: Gate[] = [
  {
    id: 'KF2.1',
    phase: 2,
    title: 'F2 birim ve kanca testleri',
    kind: 'auto',
    threshold: 'çıkış kodu 0',
    async measure({ run }) {
      const result = await run('npx', ['jest', ...UNIT_FILES]);
      const tests = /Tests:\s+(.*)/.exec(result.out)?.[1] ?? '';
      return result.code === 0 ? { status: 'pass', measured: tests || 'geçti' } : { status: 'fail', measured: tests || result.out.trim().split('\n').slice(-3).join(' / ') };
    },
  },
  {
    id: 'KF2.2',
    phase: 2,
    title: 'Otomatik indirme, hücresel onay ve konum düğmesi: iOS simülatör, Android emülatör ve iPhone',
    kind: 'device',
    threshold: `${IDS.join(', ')} üç cihazda geçti`,
    async measure({ reportDir }) {
      const reports = uploadedReports(reportDir);
      const sim = deviceGate(reports, IDS, (r) => isSimulator(r) && isIos27(r), 'iOS 27 simülatör');
      const phone = deviceGate(reports, IDS, (r) => !isSimulator(r), 'iPhone');
      const android = deviceGate(reports, IDS, (r) => isSimulator(r) && isAndroid(r), 'Android emülatör');
      const all = [sim, phone, android];
      const status = all.some((one) => one.status === 'fail') ? 'fail' : all.every((one) => one.status === 'pass') ? 'pass' : 'open';
      return { status, measured: all.map((one) => one.measured).join('; ') };
    },
  },
  {
    id: 'KF2.3',
    phase: 2,
    title: 'iPhone: gerçek konumla bulunulan ilin paketi kendiliğinden iner',
    kind: 'device',
    threshold: 'sdk.real-location-download kaydı geçti (uygulama sekmesi, gerçek GPS)',
    async measure({ reportDir }) {
      const report = uploadedReports(reportDir).find((r) => !isSimulator(r) && r.entries.some((entry) => entry.id === 'sdk.real-location-download'));
      if (!report) return { status: 'open', measured: 'gerçek konum raporu yok' };
      const entry = report.entries.find((e) => e.id === 'sdk.real-location-download')!;
      return entry.outcome === 'pass' ? { status: 'pass', measured: `${report.reportId}: ${entry.note ?? ''}` } : { status: 'fail', measured: `${report.reportId}: ${entry.note ?? entry.outcome}` };
    },
  },
  {
    id: 'KF2.4',
    phase: 2,
    title: 'Arka plan indirme sonucu ölçüldü ve README\'de yazılı',
    kind: 'device',
    threshold: 'sdk.bg-probe raporu var; README "Background downloads" bölümü var',
    async measure({ reportDir, run }) {
      const report = uploadedReports(reportDir).find((r) => !isSimulator(r) && r.entries.some((entry) => entry.id === 'sdk.bg-probe' && entry.outcome === 'info'));
      if (!report) return { status: 'open', measured: 'arka plan deneme raporu yok' };
      const readme = await run('sh', ['-c', 'grep -c "Background downloads" README.md']);
      return readme.code === 0 && readme.out.trim() !== '0' ? { status: 'pass', measured: `${report.reportId}; README bölümü var` } : { status: 'fail', measured: 'README bölümü yok' };
    },
  },
  {
    id: 'KF2.5',
    phase: 2,
    title: 'Temizlik denetimi',
    kind: 'auto',
    threshold: 'çıktı boş',
    async measure(ctx) {
      const result = await ctx.run('sh', ['-c', 'cd .. && node tools/geo-clean-check.mjs yuksi-geo']);
      return result.code === 0 && result.out.trim() === '' ? { status: 'pass', measured: 'temiz' } : { status: 'fail', measured: result.out.trim().split('\n').slice(0, 3).join(' / ') || `çıkış kodu ${result.code}` };
    },
  },
];
