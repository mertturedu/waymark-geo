import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { freshnessProblems } from '../scripts/release-lib';
import type { Sources } from '../scripts/fetch-sources';
import type { Gate, GateContext } from './engine';
import { readReports } from './phase-5';

const tail = (out: string): string => out.trim().split('\n').slice(-3).join(' / ');

const auto = (id: string, title: string, threshold: string, measure: Gate['measure']): Gate => ({ id, phase: 8, title, kind: 'auto', threshold, measure });

const tests = (files: string[], name?: string) => async ({ run }: GateContext) => {
  const { code, out } = await run('npx', ['jest', ...files, ...(name ? ['-t', name] : [])]);
  return { status: code === 0 ? ('pass' as const) : ('fail' as const), measured: /Tests:\s+(.*)/.exec(out)?.[1] ?? tail(out) };
};

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

const releases = (repoRoot: string): string[] => {
  const dir = join(repoRoot, 'dist', 'releases');
  return existsSync(dir) ? readdirSync(dir).filter((t) => existsSync(join(dir, t, 'summary.json'))).sort() : [];
};

export const RECHECK = [
  ['scripts/measure-packs.ts', 'counts'],
  ['scripts/measure-packs.ts', 'tiles'],
  ['scripts/measure-packs.ts', 'sizes'],
  ['scripts/measure-address.ts', 'full'],
  ['scripts/measure-address.ts', 'typo'],
  ['scripts/measure-address.ts', 'reverse'],
  ['scripts/measure-route.ts', 'exact'],
  ['scripts/measure-route.ts', 'connectivity'],
  ['scripts/measure-route.ts', 'sizes'],
  ['scripts/measure-plan.ts', 'exact'],
] as const;

export const phase8Gates: Gate[] = [
  auto('K8.1', 'Tazelik', 'OSM ve karo tarihi yayın anında en çok 7 günlük, ikisi arası en çok 3 gün', async ({ repoRoot }) => {
    const tags = releases(repoRoot);
    const latest = tags[tags.length - 1];
    if (!latest) return { status: 'fail', measured: 'yayın yok' };
    const dir = join(repoRoot, 'dist', 'releases', latest);
    const sources = JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8')) as Sources;
    const problems = freshnessProblems(sources, statSync(join(dir, 'summary.json')).mtime);
    return { status: problems.length === 0 ? 'pass' : 'fail', measured: problems.length === 0 ? `yayın ${latest}: OSM ${sources.osmTimestamp}, karo ${sources.tilesOsmTime}` : problems.join('; ') };
  }),
  auto('K8.2', 'Gerileme', 'il başına adres ve sokak en çok yüzde 2, yol düğümü en çok yüzde 3 düşer, karo boyutu en çok yüzde 25 oynar; aşan fark açıklanıp onaylanır', async ({ repoRoot, reportDir }) => {
    const tags = releases(repoRoot);
    const latest = tags[tags.length - 1];
    if (!latest || tags.length < 2) return { status: 'fail', measured: 'karşılaştırılacak önceki yayın yok' };
    const file = join(reportDir, `faz-8-degisim-${latest}.md`);
    if (!existsSync(file)) return { status: 'fail', measured: `değişim raporu yok (${latest})` };
    const text = readFileSync(file, 'utf8');
    const approved = existsSync(join(reportDir, 'faz-8-kararlar', `${latest}.md`));
    const pass = /K8\.2\): GEÇTİ/.test(text) || approved;
    return { status: pass ? 'pass' : 'fail', measured: pass ? `${latest}: ${/K8\.2\): GEÇTİ/.test(text) ? 'fark eşiklerin içinde' : 'farklar yazılı kararla onaylandı'}` : `${latest}: eşik aşan farklar var, onay yok` };
  }),
  auto('K8.3', 'Önceki kapılar yeni veriyle', 'adres, rota, plan ve paket ölçümleri yeni yayında yeniden geçer', async ({ run }) => {
    const failed: string[] = [];
    for (const [script, name] of RECHECK) {
      const { code, out } = await run('npx', ['tsx', script, '--check', name]);
      if (code !== 0) failed.push(`${name}: ${lastJson(out)?.measured ?? tail(out)}`);
    }
    return { status: failed.length === 0 ? 'pass' : 'fail', measured: failed.length === 0 ? `${RECHECK.length} ölçüm geçti` : failed.join('; ') };
  }),
  auto('K8.4', 'Güncelleme benzetimi', 'v1 kurulu, v2de bazı dosyalar değişik: yalnızca değişenler iner; her aşamada kesintide v1 kullanılabilir; öğrenilen veri korunur', tests(['test/packs/update-simulation.test.ts', 'test/packs/lifecycle.test.ts', 'test/packs/update-throttle.test.ts'])),
  auto('K8.5', 'Kurcalama reddedilir', 'kurcalanmış manifest, kurcalanmış dosya ve yanlış anahtar', tests(['test/packs/update-simulation.test.ts', 'test/packs/verify.test.ts'])),
  auto('K8.6', 'Aynı veri tarihiyle aynı yayın', 'üretim bayt bayt aynı', async ({ run }) => {
    const { code, out } = await run('npx', ['tsx', 'scripts/measure-packs.ts', '--check', 'determinism']);
    return { status: code === 0 ? 'pass' : 'fail', measured: lastJson(out)?.measured ?? tail(out) };
  }),
  { id: 'K8.7', phase: 8, title: 'Cihaz: v1 den v2 ye güncelleme', kind: 'device', allowOpen: true, threshold: 'iPhone Release: v1 kurulu, v2 gelince güncellenir ve öğrenilmiş adres hâlâ doğru çıkar (sdk.update-keeps-learning)', async measure({ reportDir }) {
    const reports = readReports(reportDir).filter((r) => r.device.os.toLowerCase().startsWith('ios') && r.sdk.build === 'release');
    if (reports.length === 0) return { status: 'open', measured: 'Release cihaz raporu yok' };
    const entry = reports[reports.length - 1]?.entries.find((e) => e.id === 'sdk.update-keeps-learning');
    if (!entry) return { status: 'open', measured: 'güncelleme testi cihaz raporunda yok' };
    return { status: entry.outcome === 'pass' ? 'pass' : 'fail', measured: `sdk.update-keeps-learning ${entry.outcome}` };
  } },
  auto('K8.8', 'Yayın komutları', 'data:release bayrakları, değişim raporu ve gerileme karşılaştırması, data:publish kuru çalıştırması birim testlerinden geçer', tests(['test/scripts/release-lib.test.ts', 'test/scripts/data-release.test.ts'])),
];
