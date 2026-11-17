import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolvePlates } from '../pipeline/build/orchestrate';
import { renderSources, type Sources } from './fetch-sources';
import { compareReleases, freshnessProblems, latestRelease, renderChangeReport, summarizeRelease, tagOf } from './release-lib';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const LATEST_URL = 'https://download.geofabrik.de/europe/turkey-latest.osm.pbf';

export type ReleaseFlags = { skipWeekly: boolean; regions: string; pbf?: string; allowStale: boolean; approveRegressions: boolean; promote: boolean; keepSources: boolean; revision?: number };

export function parseFlags(argv: string[]): ReleaseFlags {
  const value = (name: string): string | undefined => {
    const joined = argv.find((a) => a.startsWith(`${name}=`));
    if (joined) return joined.slice(name.length + 1);
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const pbf = value('--pbf');
  const revision = Number(value('--revision'));
  return { skipWeekly: argv.includes('--skip-weekly'), regions: value('--regions') ?? '12il', ...(pbf ? { pbf } : {}), keepSources: argv.includes('--keep-sources'), ...(Number.isInteger(revision) && revision > 1 ? { revision } : {}), allowStale: argv.includes('--allow-stale'), approveRegressions: argv.includes('--approve-regressions'), promote: !argv.includes('--no-promote') };
}

const run = (cmd: string, args: string[]): number => spawnSync(cmd, args, { cwd: repoRoot, stdio: 'inherit' }).status ?? 1;

async function download(target: string): Promise<void> {
  const response = await fetch(LATEST_URL);
  if (!response.ok || !response.body) throw new Error(`Geofabrik: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(target, bytes);
}

export const mayPromote = (input: { comparisonFailed: boolean; weeklyFailed: boolean; approve: boolean }): boolean => input.approve || (!input.comparisonFailed && !input.weeklyFailed);

export async function main(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const log = (line: string): void => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
  const plates = resolvePlates(flags.regions);
  const sourcesFile = join(repoRoot, 'pipeline', 'data', 'sources.json');
  if (!flags.keepSources) {
    let pbf = flags.pbf;
    if (!pbf) {
      pbf = join(repoRoot, 'pipeline', 'data', 'turkey-latest.download.osm.pbf');
      log('Geofabrik dosyası indiriliyor');
      await download(pbf);
    }
    if (run('npx', ['tsx', 'scripts/fetch-sources.ts', '--pbf', pbf]) !== 0) return 1;
  }
  const loaded = JSON.parse(readFileSync(sourcesFile, 'utf8')) as Sources;
  const sources: Sources = flags.revision ? { ...loaded, revision: flags.revision } : loaded;
  if (flags.revision) writeFileSync(sourcesFile, renderSources(sources));
  const problems = freshnessProblems(sources, new Date());
  if (problems.length > 0) {
    for (const problem of problems) console.error(`tazelik (K8.1): ${problem}`);
    if (!flags.allowStale) return 1;
  }
  const tag = tagOf(sources);
  const releaseDir = join(repoRoot, 'dist', 'releases', tag);
  const packs = join(releaseDir, 'packs');
  mkdirSync(releaseDir, { recursive: true });
  log(`yayın ${tag}: ${plates.length} il`);
  if (run('npx', ['tsx', 'scripts/data-build.ts', `--regions=${flags.regions}`, '--out', packs]) !== 0) return 1;
  const workDir = join(repoRoot, 'dist', 'work', sources.osmFile.slice(7, 13));
  const summary = summarizeRelease(workDir, packs, sources, plates);
  const previous = latestRelease(join(repoRoot, 'dist', 'releases'), tag);
  writeFileSync(join(releaseDir, 'summary.json'), JSON.stringify(summary));
  writeFileSync(join(releaseDir, 'sources.json'), JSON.stringify(sources, null, 2) + '\n');
  const reports = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
  mkdirSync(reports, { recursive: true });
  let failed = false;
  if (previous) {
    const comparison = compareReleases(previous, summary);
    writeFileSync(join(reports, `faz-8-degisim-${tag}.md`), renderChangeReport(previous, summary, comparison));
    failed = comparison.violations.length > 0;
    log(`önceki yayın ${previous.tag}: ${comparison.violations.length} gerileme farkı, rapor faz-8-degisim-${tag}.md`);
  } else log('önceki yayın yok, bu yayın başlangıç noktası');
  const weeklyFailed = flags.skipWeekly ? false : run('npx', ['tsx', 'scripts/weekly.ts', '--tag', tag, ...(flags.approveRegressions ? ['--approve-regressions'] : [])]) !== 0;
  if (!mayPromote({ comparisonFailed: failed, weeklyFailed, approve: flags.approveRegressions })) {
    console.error(`gerileme kapısı (${failed ? 'K8.2' : 'K18.2'}) tutmadı; farklar açıklanıp onaylanana kadar yayın dist/packs içine alınmadı (--approve-regressions)`);
    return 1;
  }
  if (flags.promote) {
    const live = join(repoRoot, 'dist', 'packs');
    const old = join(repoRoot, 'dist', 'packs.previous');
    rmSync(old, { recursive: true, force: true });
    if (existsSync(live)) renameSync(live, old);
    cpSync(packs, live, { recursive: true });
    log(`dist/packs yayın ${tag} ile eşitlendi`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
