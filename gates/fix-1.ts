import type { Gate } from './engine';
import type { DeviceReport } from '../src/core/report/types';
import { uploadedReports } from './fix-0';

const UNIT_FILES = ['test/map/camera.test.ts', 'test/map/hoods.test.ts', 'test/native/location.test.ts', 'test/react', 'test/example/scene-lifecycle.test.ts', 'test/example/map-tour-driver.test.ts', 'test/example/autorun.test.ts', 'test/i18n'];
const DEVICE_IDS = ['sdk.map-open-once', 'sdk.camera-bearing'];

export const isSimulator = (report: DeviceReport): boolean => report.device.model.endsWith('-sim');
export const isIos27 = (report: DeviceReport): boolean => /^iOS 27(\.|$)/.test(report.device.os);

const passed = (report: DeviceReport, id: string): boolean => report.entries.some((entry) => entry.id === id && entry.outcome === 'pass');

export function deviceGate(reports: DeviceReport[], ids: string[], pick: (report: DeviceReport) => boolean, label: string): { status: 'pass' | 'fail' | 'open'; measured: string } {
  const report = reports.find((r) => pick(r) && ids.every((id) => r.entries.some((entry) => entry.id === id)));
  if (!report) return { status: 'open', measured: `${label}: rapor yok` };
  const failed = ids.filter((id) => !passed(report, id));
  return failed.length === 0 ? { status: 'pass', measured: `${label} ${report.reportId}: geçti` } : { status: 'fail', measured: `${label} ${report.reportId}: geçmeyen ${failed.join(', ')}` };
}

export function repeatGate(reports: DeviceReport[], id: string, times: number): { status: 'pass' | 'fail' | 'open'; measured: string } {
  const ids = [id, ...Array.from({ length: times - 1 }, (_, i) => `${id}#${i + 2}`)];
  const report = reports.find((r) => ids.every((each) => r.entries.some((entry) => entry.id === each)));
  if (!report) return { status: 'open', measured: `${times} tekrarlı rapor yok` };
  const ok = ids.filter((each) => passed(report, each)).length;
  return ok === times ? { status: 'pass', measured: `${report.reportId}: ${ok}/${times}` } : { status: 'fail', measured: `${report.reportId}: ${ok}/${times}` };
}

export const fix1Gates: Gate[] = [
  {
    id: 'KF1.0',
    phase: 1,
    title: 'iOS 27 simülatöründe uygulama açılır ve otomatik hat dokunmadan koşar',
    kind: 'device',
    threshold: 'iOS 27 simülatör raporunda sdk.map-open geçti',
    async measure({ reportDir }) {
      return deviceGate(uploadedReports(reportDir), ['sdk.map-open'], (r) => isSimulator(r) && isIos27(r), 'iOS 27 simülatör');
    },
  },
  {
    id: 'KF1.1',
    phase: 1,
    title: 'F1 birim testleri',
    kind: 'auto',
    threshold: 'çıkış kodu 0',
    async measure({ run }) {
      const result = await run('npx', ['jest', ...UNIT_FILES]);
      const tests = /Tests:\s+(.*)/.exec(result.out)?.[1] ?? '';
      return result.code === 0 ? { status: 'pass', measured: tests || 'geçti' } : { status: 'fail', measured: tests || result.out.trim().split('\n').slice(-3).join(' / ') };
    },
  },
  {
    id: 'KF1.2',
    phase: 1,
    title: 'Tek stil yüklemesi ve kamera yönü: simülatör ve iPhone',
    kind: 'device',
    threshold: `${DEVICE_IDS.join(', ')} iki cihazda geçti`,
    async measure({ reportDir }) {
      const reports = uploadedReports(reportDir);
      const sim = deviceGate(reports, DEVICE_IDS, isSimulator, 'simülatör');
      const phone = deviceGate(reports, DEVICE_IDS, (r) => !isSimulator(r), 'iPhone');
      const status = sim.status === 'fail' || phone.status === 'fail' ? 'fail' : sim.status === 'pass' && phone.status === 'pass' ? 'pass' : 'open';
      return { status, measured: `${sim.measured}; ${phone.measured}` };
    },
  },
  {
    id: 'KF1.3',
    phase: 1,
    title: 'sdk.map-cargo arka arkaya 10 kez geçer',
    kind: 'device',
    threshold: '10/10',
    async measure({ reportDir }) {
      return repeatGate(uploadedReports(reportDir), 'sdk.map-cargo', 10);
    },
  },
  {
    id: 'KF1.4',
    phase: 1,
    title: 'Temizlik denetimi',
    kind: 'auto',
    threshold: 'çıktı boş',
    async measure(ctx) {
      const result = await ctx.run('sh', ['-c', 'cd .. && node tools/geo-clean-check.mjs yuksi-geo']);
      return result.code === 0 && result.out.trim() === '' ? { status: 'pass', measured: 'temiz' } : { status: 'fail', measured: result.out.trim().split('\n').slice(0, 3).join(' / ') || `çıkış kodu ${result.code}` };
    },
  },
];
