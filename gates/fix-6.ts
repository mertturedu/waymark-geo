import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Gate } from './engine';
import { uploadedReports } from './fix-0';
import { deviceGate, isSimulator } from './fix-1';
import { latestFullRun } from './fix-4';

const UNIT_FILES = ['test/map', 'test/native', 'test/example', 'test/gates/fix-6.test.ts'];
const DEVICE_IDS = ['sdk.map-3d', 'sdk.map-dark'];
const TRANSIT_ID = 'sdk.map-transit';
const COMPARE_WORDS = ['zemin', 'su', 'park', 'yol', 'bina', 'renk', 'δe'];

export const fix6Gates: Gate[] = [
  {
    id: 'KF6.1',
    phase: 6,
    title: 'F6 birim testleri ve toplu taşıma çıkarıcı testi',
    kind: 'auto',
    threshold: 'jest ve pytest çıkış kodu 0',
    async measure({ run }) {
      const unit = await run('npx', ['jest', ...UNIT_FILES]);
      const tests = /Tests:\s+(.*)/.exec(unit.out)?.[1] ?? '';
      if (unit.code !== 0) return { status: 'fail', measured: tests || unit.out.trim().split('\n').slice(-3).join(' / ') };
      const python = await run('sh', ['-c', 'cd pipeline && .venv/bin/pytest tests/test_transit.py -q']);
      const py = /(\d+ passed)/.exec(python.out)?.[1] ?? '';
      return python.code === 0 ? { status: 'pass', measured: `${tests}; pytest ${py}` } : { status: 'fail', measured: `pytest: ${python.out.trim().split('\n').slice(-2).join(' / ')}` };
    },
  },
  {
    id: 'KF6.2',
    phase: 6,
    title: 'Karşılaştırma: renk ΔE hedefi (açık ve koyu), bina alan payı farkı ≤ 5 puan',
    kind: 'device',
    threshold: 'Apple karşılaştırma raporunda renk ve bina hedefleri tutuyor',
    async measure({ reportDir }) {
      const run = latestFullRun(reportDir);
      if (!run) return { status: 'open', measured: 'Apple karşılaştırma koşusu yok' };
      const checks = (run.summary.checks ?? []).filter((check) => COMPARE_WORDS.some((word) => check.name.toLowerCase().includes(word)));
      if (checks.length === 0) return { status: 'open', measured: `${run.dir}: renk hedefi satırı yok` };
      const bad = checks.filter((check) => check.ok !== true);
      const measured = `${run.dir}: ${checks.length - bad.length}/${checks.length} hedef tutuyor`;
      return bad.some((check) => check.ok === false) ? { status: 'fail', measured } : bad.length > 0 ? { status: 'open', measured } : { status: 'pass', measured };
    },
  },
  {
    id: 'KF6.3',
    phase: 6,
    title: '3B, koyu tema ve toplu taşıma cihaz testleri',
    kind: 'device',
    threshold: `${DEVICE_IDS.join(', ')} simülatör ve iPhone'da geçti; ${TRANSIT_ID} geçti`,
    async measure({ reportDir }) {
      const reports = uploadedReports(reportDir);
      const sim = deviceGate(reports, DEVICE_IDS, (r) => isSimulator(r), 'simülatör');
      const phone = deviceGate(reports, DEVICE_IDS, (r) => !isSimulator(r), 'iPhone');
      const transit = deviceGate(reports, [TRANSIT_ID], () => true, 'toplu taşıma');
      const all = [sim, phone, transit];
      const status = all.some((one) => one.status === 'fail') ? 'fail' : all.every((one) => one.status === 'pass') ? 'pass' : 'open';
      return { status, measured: all.map((one) => one.measured).join('; ') };
    },
  },
  {
    id: 'KF6.4',
    phase: 6,
    title: 'Performans F3 değerlerinden en çok %10 kötü (3B yüzünden aşarsa 3B varsayılanı kapanır)',
    kind: 'device',
    threshold: 'sdk.perf-* ölçümü F3 sonuç dosyasıyla karşılaştırıldı',
    async measure({ reportDir }) {
      return { status: 'open', measured: existsSync(join(reportDir, 'fix-3-sonuc.json')) ? 'F6 sonrası perf koşusu bekleniyor' : 'F3 ölçümü henüz yok (fix-3-sonuc.json)' };
    },
  },
  {
    id: 'KF6.5',
    phase: 6,
    title: 'Paket boyutu: İstanbul toplu taşıma ≤ 2 MB, kapı numarası katmanı il başına ≤ %8',
    kind: 'device',
    threshold: 'paketler yeniden üretildi ve boyutlar ölçüldü',
    async measure() {
      return { status: 'open', measured: 'toplu taşıma ve kapı numarası paketleri henüz üretilmedi (F7 paket yeniden üretimi)' };
    },
  },
  {
    id: 'KF6.6',
    phase: 6,
    title: 'Temizlik denetimi',
    kind: 'auto',
    threshold: 'çıktı boş',
    async measure(ctx) {
      const result = await ctx.run('sh', ['-c', 'cd .. && node tools/geo-clean-check.mjs yuksi-geo']);
      return result.code === 0 && result.out.trim() === '' ? { status: 'pass', measured: 'temiz' } : { status: 'fail', measured: result.out.trim().split('\n').slice(0, 3).join(' / ') || `çıkış kodu ${result.code}` };
    },
  },
];
