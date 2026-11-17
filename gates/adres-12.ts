import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMeasures } from '../tools/compare/measures';
import type { Gate } from './engine';
import { uploadedReports } from './fix-0';

const read = <T>(key: string): T | undefined => readMeasures()[key] as T | undefined;

type Determinism = { compared: number; equal: number; differing: string[]; onlyA: string[]; onlyB: string[]; seconds: number; same: boolean };
type Release = { seconds: number; errors: number; warnings: number; summary: Record<string, number>; perKind: Record<string, { files: number; raw: number; sent: number }>; patchStats: { made: number; cached: number; tooBig: number; unverified: number; skippedSmall: number; bytes: number } | null; findings?: { level: string; where: string; message: string }[] };

const releaseFile = (): Release | null => {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'dist', 'work', '261028', 'address-release.json'), 'utf8')) as Release;
  } catch {
    return null;
  }
};

const mb = (bytes: number): string => `${Math.round(bytes / 1e6)} MB`;

const entryOf = (reportDir: string, ios: boolean): { outcome: string; note: string } => {
  const report = uploadedReports(reportDir).filter((r) => r.entries.some((e) => e.id === 'sdk.manifest-migration')).find((r) => (ios ? /iPhone/i.test(r.device.model) : !/iPhone|iPad/i.test(r.device.model)));
  const entry = report?.entries.find((e) => e.id === 'sdk.manifest-migration');
  return { outcome: entry?.outcome ?? 'yok', note: entry?.note ?? '' };
};

export const adres12Gates: Gate[] = [
  {
    id: 'A12.1',
    phase: 12,
    title: 'Eski ve yeni SDK iki platformda hatasız: 0.7.2 manifest-v1\'i okur, yeni SDK v2\'ye geçer, telefonda geçiş testi',
    kind: 'auto',
    threshold: 'uyum testleri geçti; iPhone ve Android\'de sdk.manifest-migration pass',
    async measure({ run, reportDir }) {
      const { code, out } = await run('npx', ['jest', 'test/package/manifest-compat.test.ts', 'test/packs/manifest-migration.test.ts']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      const ios = entryOf(reportDir, true);
      const android = entryOf(reportDir, false);
      const measured = `${tail}; telefon: iPhone ${ios.outcome}, Android ${android.outcome}`;
      if (code !== 0) return { status: 'fail', measured };
      if (ios.outcome === 'yok' || android.outcome === 'yok') return { status: 'open', measured };
      return { status: ios.outcome === 'pass' && android.outcome === 'pass' ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A12.2',
    phase: 12,
    title: 'İki derleme aynı bayt (adres, bina paketleri ve ara dosyalar, 81 il)',
    kind: 'auto',
    threshold: 'ikinci derlemede her dosya birinciyle bayt bayt aynı',
    async measure() {
      const d = read<Determinism>('a12_determinism');
      if (!d) return { status: 'open', measured: 'ölçüm koşulmadı (npx tsx scripts/determinism-adres.ts)' };
      return { status: d.same ? 'pass' : 'fail', measured: `${d.equal}/${d.compared} dosya aynı, ${d.seconds} sn${d.differing.length > 0 ? `; farklı: ${d.differing.slice(0, 5).join(', ')}` : ''}` };
    },
  },
  {
    id: 'A12.3',
    phase: 12,
    title: 'Boyut, süre ve yama tablosu raporlandı',
    kind: 'auto',
    threshold: 'rapor var',
    async measure() {
      const r = releaseFile();
      if (!r) return { status: 'open', measured: 'sürüm raporu yok (npx tsx scripts/address-release.ts)' };
      const kinds = Object.entries(r.perKind).map(([k, v]) => `${k} ${v.files} dosya ${mb(v.raw)} → ${mb(v.sent)}`).join(', ');
      const p = r.patchStats;
      return { status: 'pass', measured: `${kinds}; montaj ${r.seconds} sn${p ? `; yama: ${p.made} yapıldı, ${p.cached} önbellek, ${p.tooBig} büyük, ${p.skippedSmall} küçük, ${mb(p.bytes)}` : ''}` };
    },
  },
  {
    id: 'A12.4',
    phase: 12,
    title: 'Doğrulayıcı 0 hata (81 il, iki manifest)',
    kind: 'auto',
    threshold: '0 hata',
    async measure() {
      const r = releaseFile();
      if (!r) return { status: 'open', measured: 'sürüm raporu yok' };
      return { status: r.errors === 0 ? 'pass' : 'fail', measured: `${r.errors} hata, ${r.warnings} uyarı (${r.summary.regions ?? 0} il, ${r.summary.files ?? 0} dosya)` };
    },
  },
  {
    id: 'A12.5',
    phase: 12,
    title: 'Mevcut testler gerilemedi (metin, adres, hat, paketler)',
    kind: 'auto',
    threshold: 'test/text, test/address, test/pipeline, test/packs geçiyor',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/text', 'test/address', 'test/pipeline', 'test/packs']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      return { status: code === 0 ? 'pass' : 'fail', measured: tail || (code === 0 ? 'geçti' : 'başarısız') };
    },
  },
];
