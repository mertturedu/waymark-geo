import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Gate } from './engine';
import { uploadedReports } from './fix-0';

export const TARGET_VERSION = '0.7.2';
const DOCS = ['docs/licences.md', 'CHANGELOG.md', 'README.md'];

export const sdkCheckFile = (reportDir: string, expo: string): string => join(reportDir, `fix-9-sdk-${expo}.json`);

export function sdkCheckResult(reportDir: string, expo: string): { pass: boolean; measured: string } | null {
  const file = sdkCheckFile(reportDir, expo);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { pass?: boolean; measured?: string };
    return { pass: parsed.pass === true, measured: parsed.measured ?? '' };
  } catch {
    return null;
  }
}

export function versionProblems(root: string, read: (path: string) => string | null): string[] {
  const problems: string[] = [];
  const pkg = JSON.parse(read(join(root, 'package.json')) ?? '{}') as { version?: string };
  if (pkg.version !== TARGET_VERSION) problems.push(`package.json sürümü ${pkg.version ?? '?'}`);
  if (!new RegExp(`SDK_VERSION = '${TARGET_VERSION.replace(/\./g, '\\.')}'`).test(read(join(root, 'src/core/create-geo.ts')) ?? '')) problems.push(`SDK_VERSION ${TARGET_VERSION} değil`);
  for (const file of DOCS) if (read(join(root, file)) === null) problems.push(`${file} yok`);
  const changelog = read(join(root, 'CHANGELOG.md')) ?? '';
  if (!new RegExp(`^## ${TARGET_VERSION.replace(/\./g, '\\.')}\\b`, 'm').test(changelog)) problems.push(`CHANGELOG.md'de "## ${TARGET_VERSION}" başlığı yok`);
  if (/^## Unreleased\s*\n\s*\n- /m.test(changelog)) problems.push('CHANGELOG.md hâlâ "Unreleased" altında madde taşıyor');
  return problems;
}

const readIf = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null);

export const fix9Gates: Gate[] = [
  {
    id: 'KF9.1',
    phase: 9,
    title: 'Paket dışa aktarma: derlenmiş çıktı, alt yollar, tipler, kaynak haritaları; src ve test yok',
    kind: 'auto',
    threshold: 'jest test/package çıkış kodu 0',
    async measure({ run }) {
      const result = await run('npx', ['jest', 'test/package', 'test/scripts/package-check.test.ts']);
      const tests = /Tests:\s+(.*)/.exec(result.out)?.[1] ?? '';
      return result.code === 0 ? { status: 'pass', measured: tests || 'geçti' } : { status: 'fail', measured: tests || result.out.trim().split('\n').slice(-3).join(' / ') };
    },
  },
  {
    id: 'KF9.2',
    phase: 9,
    title: 'Expo 57 ve 58 boş uygulamada (watchFolders olmadan): kurulum, tip denetimi, Android ve iOS paketi, prebuild',
    kind: 'device',
    threshold: `fix-9-sdk-57.json ve fix-9-sdk-58.json: pass`,
    async measure({ reportDir }) {
      const a = sdkCheckResult(reportDir, '57');
      const b = sdkCheckResult(reportDir, '58');
      if (!a || !b) return { status: 'open', measured: `kayıt eksik: ${[!a ? '57' : '', !b ? '58' : ''].filter(Boolean).join(', ')}` };
      const measured = `Expo 57: ${a.pass ? 'geçti' : 'kaldı'}; Expo 58: ${b.pass ? 'geçti' : 'kaldı'}`;
      return a.pass && b.pass ? { status: 'pass', measured } : { status: 'fail', measured };
    },
  },
  {
    id: 'KF9.3',
    phase: 9,
    title: `Sürüm ${TARGET_VERSION} ve belgeler (CHANGELOG, README, lisans özeti)`,
    kind: 'auto',
    threshold: 'package.json, SDK_VERSION, CHANGELOG başlığı ve belgeler tutarlı',
    async measure({ repoRoot }) {
      const problems = versionProblems(repoRoot, readIf);
      return problems.length === 0 ? { status: 'pass', measured: `sürüm ${TARGET_VERSION}, belgeler tamam` } : { status: 'fail', measured: problems.join('; ') };
    },
  },
  {
    id: 'KF9.4',
    phase: 9,
    title: 'Android gerçek cihaz (K0.4b, K5.7b ve F2 cihaz testleri)',
    kind: 'device',
    threshold: 'Android telefon raporunda sdk.auto-location, sdk.cellular-consent, sdk.locate-cycle geçti',
    allowOpen: true,
    async measure({ reportDir }) {
      const phone = uploadedReports(reportDir).filter((r) => r.device.os.startsWith('Android') && !r.device.model.endsWith('-sim'));
      if (phone.length === 0) return { status: 'open', measured: 'gerçek Android cihaz raporu yok (telefon bulunamadı)' };
      const ids = ['sdk.auto-location', 'sdk.cellular-consent', 'sdk.locate-cycle'];
      const ok = phone.some((r) => ids.every((id) => r.entries.some((e) => e.id === id && e.outcome === 'pass')));
      return ok ? { status: 'pass', measured: `${phone.length} rapor, F2 testleri geçti` } : { status: 'fail', measured: 'Android telefon raporunda F2 testleri geçmedi' };
    },
  },
  {
    id: 'KF9.5',
    phase: 9,
    title: 'Temizlik denetimi (depo ve paketlenmiş çıktı)',
    kind: 'auto',
    threshold: 'çıktı boş',
    async measure(ctx) {
      const result = await ctx.run('sh', ['-c', 'cd .. && node tools/geo-clean-check.mjs yuksi-geo']);
      return result.code === 0 && result.out.trim() === '' ? { status: 'pass', measured: 'temiz' } : { status: 'fail', measured: result.out.trim().split('\n').slice(0, 3).join(' / ') || `çıkış kodu ${result.code}` };
    },
  },
];
