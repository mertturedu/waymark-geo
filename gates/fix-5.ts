import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Gate } from './engine';
import { uploadedReports } from './fix-0';
import { deviceGate, isSimulator } from './fix-1';
import { latestFullRun } from './fix-4';

const UNIT_FILES = ['test/text/upper.test.ts', 'test/map', 'test/pipeline/tiles.test.ts', 'test/pipeline/overture.test.ts', 'test/example', 'test/gates/fix-5.test.ts'];
const DEVICE_IDS = ['sdk.map-labels', 'sdk.map-look', 'sdk.map-languages'];
const TARGET_CHECKS = ['sokak adı', 'satır', 'çakışma'];
export const FONT_FILE = ['fix-5-kararlar', 'yazi-tipi.json'];
export const FONT_CHOICES = ['inter', 'noto'];

export function fontChoice(reportDir: string): { choice: string; note: string } | null {
  const file = join(reportDir, ...FONT_FILE);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { choice?: string; note?: string };
    return parsed.choice && FONT_CHOICES.includes(parsed.choice) ? { choice: parsed.choice, note: parsed.note ?? '' } : null;
  } catch {
    return null;
  }
}

export const fix5Gates: Gate[] = [
  {
    id: 'KF5.1',
    phase: 5,
    title: 'F5 birim testleri (büyük harf, kısaltma, stil, yazı tipi, taban paket)',
    kind: 'auto',
    threshold: 'çıkış kodu 0',
    async measure({ run }) {
      const result = await run('npx', ['jest', ...UNIT_FILES]);
      const tests = /Tests:\s+(.*)/.exec(result.out)?.[1] ?? '';
      return result.code === 0 ? { status: 'pass', measured: tests || 'geçti' } : { status: 'fail', measured: tests || result.out.trim().split('\n').slice(-3).join(' / ') };
    },
  },
  {
    id: 'KF5.2',
    phase: 5,
    title: 'Ölçüm hedefleri: sokak adı ≥ %80, 3 satırlık ad 0, çakışma 0',
    kind: 'device',
    threshold: 'ölçüm raporunda ilgili hedefler tutuyor',
    async measure({ reportDir }) {
      const run = latestFullRun(reportDir);
      if (!run) return { status: 'open', measured: 'ölçüm koşusu yok' };
      const checks = (run.summary.checks ?? []).filter((check) => TARGET_CHECKS.some((word) => check.name.toLowerCase().includes(word)));
      if (checks.length === 0) return { status: 'open', measured: `${run.dir}: hedef satırı yok` };
      const bad = checks.filter((check) => check.ok !== true);
      const measured = `${run.dir}: ${checks.length - bad.length}/${checks.length} hedef tutuyor${bad.length ? `; tutmayan: ${bad.map((check) => check.name).join(', ')}` : ''}`;
      return bad.some((check) => check.ok === false) ? { status: 'fail', measured } : bad.length > 0 ? { status: 'open', measured } : { status: 'pass', measured };
    },
  },
  {
    id: 'KF5.3',
    phase: 5,
    title: 'Yazı cihaz testleri: iOS simülatör ve iPhone',
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
    id: 'KF5.4',
    phase: 5,
    title: 'Performans F3 değerlerinden en çok %10 kötü',
    kind: 'device',
    threshold: 'sdk.perf-* ölçümü F3 sonuç dosyasıyla karşılaştırıldı',
    async measure({ reportDir }) {
      return existsSync(join(reportDir, 'fix-3-sonuc.json')) ? { status: 'open', measured: 'F5 sonrası perf koşusu bekleniyor' } : { status: 'open', measured: 'F3 ölçümü henüz yok (fix-3-sonuc.json)' };
    },
  },
  {
    id: 'KF5.5',
    phase: 5,
    title: 'Kullanıcı yazı tipini seçti (Inter ya da Noto)',
    kind: 'decision',
    threshold: 'fix-5-kararlar/yazi-tipi.json: { "choice": "inter" | "noto" }',
    async measure({ reportDir }) {
      const picked = fontChoice(reportDir);
      return picked ? { status: 'pass', measured: `seçim: ${picked.choice}${picked.note ? ` (${picked.note})` : ''}` } : { status: 'open', measured: 'karşılaştırma sayfası kullanıcıya gösterilecek: yazi-tipi/karsilastirma.html' };
    },
  },
  {
    id: 'KF5.6',
    phase: 5,
    title: 'Temizlik denetimi',
    kind: 'auto',
    threshold: 'çıktı boş',
    async measure(ctx) {
      const result = await ctx.run('sh', ['-c', 'cd .. && node tools/geo-clean-check.mjs yuksi-geo']);
      return result.code === 0 && result.out.trim() === '' ? { status: 'pass', measured: 'temiz' } : { status: 'fail', measured: result.out.trim().split('\n').slice(0, 3).join(' / ') || `çıkış kodu ${result.code}` };
    },
  },
];
