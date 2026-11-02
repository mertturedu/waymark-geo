import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTO_IDS, DEFERRED_IDS, INFO_IDS, QUESTION_IDS, RESTART_IDS, SPEED_ID } from '../example/src/sdk-test/ids';
import { readBuildReport, sourceHash } from '../scripts/check-builds';
import type { DeviceReport } from '../src/core/report/types';
import type { Gate, GateContext } from './engine';

const tail = (out: string): string => out.trim().split('\n').slice(-3).join(' / ');

const tests = (files: string[]) => async ({ run }: GateContext) => {
  const { code, out } = await run('npx', ['jest', ...files]);
  const summary = /Tests:\s+(.*)/.exec(out)?.[1];
  return { status: code === 0 ? ('pass' as const) : ('fail' as const), measured: summary ?? tail(out) };
};

const auto = (id: string, title: string, threshold: string, measure: Gate['measure']): Gate => ({ id, phase: 5, title, kind: 'auto', threshold, measure });

export const readReports = (dir: string): DeviceReport[] => {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const reports: DeviceReport[] = [];
  for (const name of names.filter((f) => f.startsWith('cihaz-') && f.endsWith('.json'))) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')) as DeviceReport;
      if (Array.isArray(parsed.entries) && typeof parsed.device?.os === 'string' && typeof parsed.sdk?.build === 'string') reports.push(parsed);
    } catch {
      continue;
    }
  }
  return reports;
};

const REQUIRED_PASS = [...AUTO_IDS, ...RESTART_IDS, ...QUESTION_IDS];

export function missingFor(report: DeviceReport): string[] {
  const outcome = (id: string) => report.entries.find((e) => e.id === id)?.outcome;
  return [...REQUIRED_PASS.filter((id) => outcome(id) !== 'pass'), ...INFO_IDS.filter((id) => outcome(id) === undefined)];
}

const deviceGate = (osPrefix: string, allowOpen: boolean): Gate => ({
  id: allowOpen ? 'K5.7b' : 'K5.7',
  phase: 5,
  title: `Cihaz denetim listesi (${osPrefix}, Release)`,
  kind: 'device',
  threshold: `Release raporunda ${REQUIRED_PASS.length} kayıt geçti (arama hızı p95 en çok 150 ms dahil), ${INFO_IDS.length} bilgi kaydı var; ${DEFERRED_IDS.length} soru Faz 6 cihaz turuna ertelendi`,
  allowOpen,
  async measure({ reportDir }: GateContext) {
    const reports = readReports(reportDir).filter((r) => r.device.os.startsWith(osPrefix) && r.sdk.build === 'release' && r.entries.some((e) => e.id === SPEED_ID));
    if (reports.length === 0) return { status: allowOpen ? 'open' : 'fail', measured: `${osPrefix} için SDK testi içeren Release raporu yok` };
    const best = reports.map((r) => ({ r, missing: missingFor(r) })).sort((a, b) => a.missing.length - b.missing.length)[0]!;
    if (best.missing.length === 0) {
      const speed = best.r.entries.find((e) => e.id === SPEED_ID);
      return { status: 'pass', measured: `rapor ${best.r.reportId}; arama p95 ${speed?.value ?? '?'} ms` };
    }
    return { status: 'fail', measured: `en iyi rapor ${best.r.reportId}: eksik ya da geçmeyen ${best.missing.length}: ${best.missing.slice(0, 6).join(', ')}${best.missing.length > 6 ? '…' : ''}` };
  },
});

const lastJson = (out: string): { measured?: string } | null => {
  for (const line of out.trim().split('\n').reverse()) {
    try {
      const parsed = JSON.parse(line) as { measured?: string };
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {
      continue;
    }
  }
  return null;
};

const directory = (name: string) => async ({ run }: GateContext) => {
  const { code, out } = await run('npx', ['tsx', 'scripts/measure-directory.ts', '--check', name]);
  return { status: code === 0 ? ('pass' as const) : ('fail' as const), measured: lastJson(out)?.measured ?? tail(out) };
};

export const phase5Gates: Gate[] = [
  auto('K5.1', 'Paket yöneticisi durum makinesi ve hata enjeksiyonu', 'tüm geçişler ve kopma, disk dolu, SHA, imza, 404, yeni biçim senaryoları geçer; bozuk dosya kullanılmaz', tests(['test/packs'])),
  auto('K5.2', 'İl bulma', '81 ilde 10 bin nokta yüzde 100 doğru; sınıra 1 km içinde komşu önerilir', tests(['test/packs/region.test.ts', 'test/region/near-border.test.ts'])),
  auto('K5.3', 'Geçici Expo uygulamasında paket', 'tsc, expo export android ve ios, prebuild geçer', async ({ run }) => {
    const { code, out } = await run('npx', ['tsx', 'scripts/package-check.ts']);
    const last = out.trim().split('\n').reverse().find((line) => line.startsWith('{'));
    let measured = tail(out);
    try {
      measured = (JSON.parse(last ?? '') as { measured: string }).measured;
    } catch {
      measured = tail(out);
    }
    return { status: code === 0 ? 'pass' : 'fail', measured };
  }),
  auto('K5.4', 'Örnek uygulama derlenir', 'Android assembleDebug ve iOS xcodebuild, kaynak değişmeden', async ({ repoRoot, reportDir }) => {
    const report = readBuildReport(reportDir);
    if (!report) return { status: 'fail', measured: 'derleme kaydı yok; npm run build-check çalıştır' };
    if (report.source !== sourceHash(repoRoot)) return { status: 'fail', measured: 'derleme kaydı eski, kaynak değişmiş; npm run build-check yeniden çalıştır' };
    const ok = report.android.ok && report.ios.ok;
    return { status: ok ? 'pass' : 'fail', measured: `android ${report.android.ok ? 'tamam' : 'hata'} (${report.android.seconds} sn), ios ${report.ios.ok ? 'tamam' : 'hata'} (${report.ios.seconds} sn)` };
  }),
  auto('K5.5', 'SDK metinleri 6 dilde eksiksiz', 'eksik anahtar sıfır', tests(['test/i18n'])),
  auto('K5.6', 'Ağ kullanımı', 'yalnızca manifest adresi ve manifestteki dosyalar', tests(['test/geo/network-allowlist.test.ts'])),
  auto('K5.6b', 'Başka ilde arama', 'inmemiş ilde region_missing; yalnızca adres paketiyle sonuç, harita ve temel paket inmez', tests(['test/packs/store.test.ts', 'test/geo/create-geo.test.ts'])),
  deviceGate('iOS', false),
  deviceGate('Android', true),
  auto('K5.8', 'Mutasyon ve kapsam', 'paket yöneticisi, metinler, il bulma ve arayüz mantığında mutasyon en az yüzde 80; kapsam eşikleri', async ({ run }) => {
    const mutation = await run('npx', ['stryker', 'run', '--mutate', 'src/{core/packs,core/i18n,native/logic,native/map}/*.ts,src/core/region/borders.ts']);
    const score = /All files\s*\|\s*([\d.]+)/.exec(mutation.out)?.[1];
    const coverage = await run('npx', ['jest', '--coverage', '--silent']);
    const status = mutation.code === 0 && coverage.code === 0 ? ('pass' as const) : ('fail' as const);
    return { status, measured: `mutasyon ${score ?? tail(mutation.out)}; kapsam eşikleri ${coverage.code === 0 ? 'geçti' : 'tutmadı'}` };
  }),
  auto('K5.9', 'Rehber paketi doğruluğu', 'rehber ile adres paketinde aynı kapı için en az 1000 eşleşme, ortanca en çok 30 m, p90 en çok 150 m', directory('accuracy')),
  auto('K5.9b', 'Rehber kapıları aranınca bulunur', '12 ilde rehber kapılarından örnek tam adres olarak aratılınca ilk 3te 100 m içinde en az yüzde 90', directory('roundtrip')),
  auto('K5.9d', 'Rehberle birlikte arama hızı (Node)', 'İstanbul adres paketi ve rehber kuruluyken resolve p95 en çok 25 ms, autocomplete p95 en çok 10 ms', async ({ run }) => {
    const { code, out } = await run('npx', ['tsx', 'scripts/measure-address.ts', '--check', 'speed-directory']);
    return { status: code === 0 ? ('pass' as const) : ('fail' as const), measured: lastJson(out)?.measured ?? tail(out) };
  }),
  auto('K5.9c', 'Rehber işletmelerinde kapı numarası', '12 ilde rehberdeki her işletmenin ayrıntı satırı var, en az yüzde 50sinin kapı numarası biliniyor', directory('details')),
];
