import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Gate } from './engine';
import { uploadedReports } from './fix-0';
import { deviceGate, isSimulator } from './fix-1';
import { DARK_BASE, LIGHT_BASE } from '../src/native/map/base-colors';
import { contrast } from '../src/native/map/theme';

const UNIT_FILES = ['test/map', 'test/native', 'test/example', 'test/gates/fix-6.test.ts'];
const DEVICE_IDS = ['sdk.map-3d', 'sdk.map-dark'];
const TRANSIT_ID = 'sdk.map-transit';
const MIN_LABEL_CONTRAST = 3;

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
    title: 'Okunabilirlik: yol ve yer adı ile zemin kontrastı ≥ 3 (açık ve koyu)',
    kind: 'auto',
    threshold: 'her etiket rengi kendi zemininde WCAG kontrastı ≥ 3',
    async measure() {
      const pairs: [string, string][] = [];
      for (const [name, base] of [['açık', LIGHT_BASE], ['koyu', DARK_BASE]] as const) {
        for (const key of ['roads_label_minor', 'roads_label_major', 'city_label', 'subplace_label'] as const) pairs.push([`${name} ${key}`, `${base[key]}|${base.earth}`]);
      }
      const rows = pairs.map(([name, colours]) => {
        const [ink, ground] = colours.split('|') as [string, string];
        return { name, ratio: contrast(ink, ground) };
      });
      const worst = rows.reduce((low, row) => (row.ratio < low.ratio ? row : low));
      const measured = `${rows.length} çift, en düşük ${worst.ratio.toFixed(2)} (${worst.name})`;
      return worst.ratio >= MIN_LABEL_CONTRAST ? { status: 'pass', measured } : { status: 'fail', measured };
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
