import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Gate } from './engine';

const COMPARE_DIR = 'harita-karsilastirma';
const MIN_PHONE_SSIM = 0.8;

type Summary = { checks?: { name: string; ok: boolean | null }[]; rows?: unknown[] };

const readJson = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
};

export function latestFullRun(reportDir: string): { dir: string; summary: Summary } | null {
  const root = join(reportDir, COMPARE_DIR);
  if (!existsSync(root)) return null;
  const days = readdirSync(root).filter((name) => /^\d{4}-\d{2}-\d{2}/.test(name)).sort().reverse();
  for (const day of days) {
    const dir = join(root, day);
    const summary = readJson<Summary>(join(dir, 'ozet.json'));
    if (summary?.rows?.length) return { dir, summary };
  }
  return null;
}

export function phoneGap(reportDir: string): { ssim: number; spots: number } | null {
  const file = readJson<{ spots?: { ssim: number }[] }>(join(reportDir, COMPARE_DIR, 'telefon-fark.json'));
  const spots = file?.spots ?? [];
  if (spots.length === 0) return null;
  return { ssim: spots.reduce((sum, spot) => sum + spot.ssim, 0) / spots.length, spots: spots.length };
}

export const fix4Gates: Gate[] = [
  {
    id: 'KF4.1',
    phase: 4,
    title: 'Karşılaştırma aracının testleri',
    kind: 'auto',
    threshold: 'çıkış kodu 0',
    async measure({ run }) {
      const result = await run('sh', ['-c', 'cd ../tools/map-compare && npm test']);
      const pass = /ℹ pass (\d+)/.exec(result.out)?.[1];
      return result.code === 0 ? { status: 'pass', measured: `${pass ?? '?'} test geçti` } : { status: 'fail', measured: result.out.trim().split('\n').slice(-3).join(' / ') };
    },
  },
  {
    id: 'KF4.2',
    phase: 4,
    title: 'Telefon görüntüsü ile başsız çizim arasındaki fark küçük',
    kind: 'device',
    threshold: `5 noktada ortalama SSIM ≥ ${MIN_PHONE_SSIM}`,
    async measure({ reportDir }) {
      const gap = phoneGap(reportDir);
      if (!gap) return { status: 'open', measured: 'telefon-fark.json yok (sdk.shot-tour + scripts/device-shots.ts koşmadı)' };
      const measured = `${gap.spots} nokta, ortalama SSIM ${gap.ssim.toFixed(3)}`;
      return gap.ssim >= MIN_PHONE_SSIM ? { status: 'pass', measured } : { status: 'fail', measured };
    },
  },
  {
    id: 'KF4.3',
    phase: 4,
    title: 'İlk tam ölçüm raporu',
    kind: 'decision',
    threshold: 'ozet.json var; hedefler kullanıcıyla kesinleşti',
    async measure({ reportDir }) {
      const run = latestFullRun(reportDir);
      if (!run) return { status: 'open', measured: 'ölçüm koşusu yok' };
      const checks = run.summary.checks ?? [];
      const failing = checks.filter((check) => check.ok === false).length;
      return { status: 'open', measured: `${run.dir}: ${run.summary.rows?.length} karşılaştırma, ${checks.length - failing}/${checks.length} hedef tutuyor; hedefleri kullanıcı onaylayacak` };
    },
  },
  {
    id: 'KF4.4',
    phase: 4,
    title: 'SDK klasörü temizlik denetiminden geçiyor',
    kind: 'auto',
    threshold: 'çıktı boş',
    async measure({ run }) {
      const result = await run('sh', ['-c', 'cd .. && node tools/geo-clean-check.mjs yuksi-geo']);
      return result.code === 0 && result.out.trim() === '' ? { status: 'pass', measured: 'temiz' } : { status: 'fail', measured: result.out.trim().split('\n').slice(0, 3).join(' / ') || `çıkış kodu ${result.code}` };
    },
  },
];
