import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './addr-sets';

export const MAX_ENGINE_AGE_DAYS = 35;
const kiyas = (): string => process.env.YUKSI_GEO_KIYAS ?? join(homedir(), '.yuksi-geo', 'kiyas');
const oracle = (): string => join(repoRoot, '..', 'tools', 'geo-oracle', 'compare.mjs');

export type EngineStatus = { name: string; ready: boolean; dataFile: string | null; osmFile: string | null; ageDays: number | null; stale: boolean; note: string };

export function nominatimStatus(sourceOsmFile: string, now = Date.now()): EngineStatus {
  const script = join(kiyas(), 'nominatim-setup.sh');
  if (!existsSync(script)) return { name: 'nominatim', ready: false, dataFile: null, osmFile: null, ageDays: null, stale: true, note: 'kurulum betiği yok' };
  const text = readFileSync(script, 'utf8');
  const pbf = /^PBF=(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  const osmFile = pbf ? (pbf.split('/').pop() ?? null) : null;
  const ageDays = Math.floor((now - statSync(script).mtimeMs) / 86_400_000);
  const differs = osmFile !== null && osmFile !== sourceOsmFile;
  const stale = differs || ageDays > MAX_ENGINE_AGE_DAYS;
  return { name: 'nominatim', ready: true, dataFile: pbf, osmFile, ageDays, stale, note: differs ? `içe aktarılan ${osmFile}, güncel kaynak ${sourceOsmFile}` : ageDays > MAX_ENGINE_AGE_DAYS ? `${ageDays} gün önce kuruldu` : 'güncel' };
}

export function refreshScript(sourceOsmFile: string, pbfPath: string): string | null {
  const script = join(kiyas(), 'nominatim-setup.sh');
  if (!existsSync(script)) return null;
  const target = join(kiyas(), `nominatim-setup-${sourceOsmFile.replace(/\.osm\.pbf$/, '')}.sh`);
  writeFileSync(target, readFileSync(script, 'utf8').replace(/^PBF=.+$/m, `PBF=${pbfPath}`));
  return target;
}

export function photonStatus(now = Date.now()): EngineStatus {
  const dir = join(kiyas(), 'photon');
  if (!existsSync(dir)) return { name: 'photon', ready: false, dataFile: null, osmFile: null, ageDays: null, stale: true, note: 'veri klasörü yok' };
  const ageDays = Math.floor((now - statSync(dir).mtimeMs) / 86_400_000);
  return { name: 'photon', ready: true, dataFile: dir, osmFile: null, ageDays, stale: ageDays > MAX_ENGINE_AGE_DAYS, note: ageDays > MAX_ENGINE_AGE_DAYS ? `${ageDays} gün önce güncellendi (veri dosya tarihinden)` : 'güncel' };
}

const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

async function main(): Promise<number> {
  const sources = JSON.parse(readFileSync(join(repoRoot, 'pipeline', 'data', 'sources.json'), 'utf8')) as { osmFile: string; osmTimestamp: string };
  const tag = arg('--tag') ?? sources.osmTimestamp.slice(0, 10).replace(/-/g, '');
  const engines = [nominatimStatus(sources.osmFile), photonStatus()];
  const lines = [`# Aylık kontrol (${new Date().toISOString().slice(0, 10)})`, '', '## Kıyas motorlarının verisi', '', '| Motor | Durum | Not |', '|---|---|---|', ...engines.map((e) => `| ${e.name} | ${e.stale ? 'YENİLENMELİ' : 'güncel'} | ${e.note} |`), ''];
  const pbf = join(repoRoot, 'pipeline', 'data', sources.osmFile);
  if (engines[0]?.stale && existsSync(pbf)) {
    const script = refreshScript(sources.osmFile, pbf);
    if (script) lines.push(`Nominatim yeniden içe aktarma betiği hazır (saatler sürer, Postgres 5433): \`bash ${script}\`. Photon için güncel dosya ile kendi kurulumunu yenileyin.`, '');
  }
  const queries = join(tmpdir(), 'oracle-sdk.json');
  const exported = spawnSync('npx', ['tsx', 'scripts/export-oracle-queries.ts', '--out', queries], { cwd: repoRoot, encoding: 'utf8' });
  if (exported.status !== 0) {
    lines.push('## Mapbox kahini', '', `Sorgular dışa aktarılamadı: ${(exported.stderr || exported.stdout).slice(-200)}`);
  } else {
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'haftalik');
    mkdirSync(dir, { recursive: true });
    const report = join(dir, `mapbox-${tag}.md`);
    const confirm = process.argv.includes('--confirm');
    const env = arg('--env');
    const args = [oracle(), '--queries', queries, '--out', report, '--history', join(dir, 'mapbox-gecmis.json'), '--tag', tag, ...(confirm ? ['--confirm'] : []), ...(env ? ['--env', env] : [])];
    const run = spawnSync('node', args, { encoding: 'utf8' });
    lines.push('## Mapbox kahini', '', confirm ? 'Gerçek koşu (kullanıcı onayıyla, `--confirm`).' : 'Kuru koşu: Mapbox\'a hiçbir şey gönderilmedi.', '', '```', (run.stdout || run.stderr).trim().slice(-600), '```', '');
    if (!confirm) lines.push(`Gerçek koşu için (her seferinde onayınızla): \`npx tsx scripts/monthly.ts --confirm --env <uygulamanın .env dosyası>\``, '');
  }
  const out = join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'haftalik', `aylik-${new Date().toISOString().slice(0, 10)}.md`);
  mkdirSync(join(out, '..'), { recursive: true });
  writeFileSync(out, lines.join('\n'));
  console.log(lines.join('\n'));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().then((code) => process.exit(code));
