import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Gate } from './engine';
import { uploadedReports } from './fix-0';
import { deviceGate, isSimulator } from './fix-1';

const UNIT_FILES = ['test/address/nearby.test.ts', 'test/route', 'test/native', 'test/react', 'test/map', 'test/gates/fix-8.test.ts'];
const LANGUAGE_FILES = ['test/i18n', 'test/route/directions.test.ts'];
const DEVICE_IDS = ['sdk.place-card', 'sdk.compass', 'sdk.nearby', 'sdk.maneuvers'];

const runJest = (files: string[]): Gate['measure'] => async ({ run }) => {
  const result = await run('npx', ['jest', ...files]);
  const tests = /Tests:\s+(.*)/.exec(result.out)?.[1] ?? '';
  return result.code === 0 ? { status: 'pass', measured: tests || 'geçti' } : { status: 'fail', measured: tests || result.out.trim().split('\n').slice(-3).join(' / ') };
};

export const fix8Gates: Gate[] = [
  { id: 'KF8.1', phase: 8, title: 'F8 birim testleri ve altın dönüş tablosu (yakındakiler, ölçek, pusula, yer seçimi, manevralar, depolama)', kind: 'auto', threshold: 'çıkış kodu 0', measure: runJest(UNIT_FILES) },
  {
    id: 'KF8.2',
    phase: 8,
    title: 'Yer kartı, pusula, yakındakiler ve yönergeler: iOS simülatör ve iPhone',
    kind: 'device',
    threshold: `${DEVICE_IDS.join(', ')} iki cihazda geçti`,
    async measure({ reportDir }) {
      const reports = uploadedReports(reportDir);
      const sim = deviceGate(reports, DEVICE_IDS, (r) => isSimulator(r), 'simülatör');
      const phone = deviceGate(reports, DEVICE_IDS, (r) => !isSimulator(r), 'iPhone');
      const all = [sim, phone];
      const status = all.some((one) => one.status === 'fail') ? 'fail' : all.every((one) => one.status === 'pass') ? 'pass' : 'open';
      return { status, measured: all.map((one) => one.measured).join('; ') };
    },
  },
  {
    id: 'KF8.3',
    phase: 8,
    title: 'Performans gerilemesi yok (F3 değerlerine göre)',
    kind: 'device',
    threshold: 'sdk.perf-* ölçümü F3 sonuç dosyasıyla karşılaştırıldı',
    async measure({ reportDir }) {
      return { status: 'open', measured: existsSync(join(reportDir, 'fix-3-sonuc.json')) ? 'F8 sonrası perf koşusu bekleniyor' : 'F3 ölçümü henüz yok (fix-3-sonuc.json)' };
    },
  },
  { id: 'KF8.4', phase: 8, title: '6 dilde eksik anahtar 0 (iletiler, yönergeler, kart ve ölçek)', kind: 'auto', threshold: 'çıkış kodu 0', measure: runJest(LANGUAGE_FILES) },
  {
    id: 'KF8.5',
    phase: 8,
    title: 'Temizlik denetimi',
    kind: 'auto',
    threshold: 'çıktı boş',
    async measure(ctx) {
      const result = await ctx.run('sh', ['-c', 'cd .. && node tools/geo-clean-check.mjs yuksi-geo']);
      return result.code === 0 && result.out.trim() === '' ? { status: 'pass', measured: 'temiz' } : { status: 'fail', measured: result.out.trim().split('\n').slice(0, 3).join(' / ') || `çıkış kodu ${result.code}` };
    },
  },
];
