import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import adminData from '../../src/core/text/data/admin.json';
import { buildBordersFile, writeBordersModule } from '../../scripts/build-borders';
import type { Sources } from '../../scripts/fetch-sources';
import { createBorders, type Borders } from '../../src/core/region/borders';
import { validatePacks } from '../validate/validate-packs';
import { buildAddressPack, type PackStats } from './address-pack';
import { buildBuildingPack } from './building-pack';
import { buildDirectoryPack } from './directory';
import { PACK_OPTIONS, graphOptionsFor, parseRoadRows } from './route-graph';
import { buildRoutePack } from './route-pack';
import { buildOverturePlaces, overtureRelease } from './overture';
import { assemblePacks, defaultKeyDir, ensureDevKey, type RegionInput } from './manifest';
import { INTER_DIR, PRIORITY_PLATES, buildBasePack, buildProvinceTiles, defaultRunner, type Runner } from './tiles';

export type Step = { name: string; key: string; always?: boolean; run: () => Promise<void> };
export type StepRecord = { name: string; ms: number; skipped: boolean };
export type BuildResult = { ok: boolean; steps: StepRecord[]; failed?: { name: string; message: string } };

const PLATES = Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

export function resolvePlates(text: string): string[] {
  if (text === 'all') return [...PLATES];
  if (text === '12il') return [...PRIORITY_PLATES].sort();
  const plates = text.split(',').map((part) => {
    const plate = /^\d{1,2}$/.test(part.trim()) ? part.trim().padStart(2, '0') : '';
    if (!PLATES.includes(plate)) throw new Error(`geçersiz plaka: "${part}"`);
    return plate;
  });
  if (new Set(plates).size !== plates.length) throw new Error('aynı plaka iki kez yazılmış');
  return plates.sort();
}

export function writeAtomic(path: string, text: string | Uint8Array): void {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

export async function runSteps(steps: Step[], options: { markers: string; force?: boolean; log?: (line: string) => void }): Promise<BuildResult> {
  mkdirSync(options.markers, { recursive: true });
  const records: StepRecord[] = [];
  for (const step of steps) {
    const marker = join(options.markers, `${digest(step.name)}.json`);
    const started = Date.now();
    if (!options.force && !step.always && existsSync(marker) && readFileSync(marker, 'utf8') === step.key) {
      records.push({ name: step.name, ms: 0, skipped: true });
      options.log?.(`${step.name}: atlandı (girdi aynı)`);
      continue;
    }
    rmSync(marker, { force: true });
    try {
      await step.run();
    } catch (error) {
      return { ok: false, steps: records, failed: { name: step.name, message: error instanceof Error ? error.message : String(error) } };
    }
    if (!step.always) writeFileSync(marker, step.key);
    records.push({ name: step.name, ms: Date.now() - started, skipped: false });
    options.log?.(`${step.name}: ${((Date.now() - started) / 1000).toFixed(1)} sn`);
  }
  return { ok: true, steps: records };
}

export function promote(staging: string, out: string): void {
  const old = `${out}.old`;
  if (!existsSync(out) && existsSync(old)) renameSync(old, out);
  if (!existsSync(staging)) throw new Error(`hazırlanan klasör yok: ${staging}`);
  mkdirSync(dirname(out), { recursive: true });
  rmSync(old, { recursive: true, force: true });
  if (existsSync(out)) renameSync(out, old);
  try {
    renameSync(staging, out);
  } catch (error) {
    if (existsSync(old)) renameSync(old, out);
    throw error;
  }
  rmSync(old, { recursive: true, force: true });
}

export async function finalizePublish(input: { staging: string; outDir: string; validate: () => Promise<{ findings: { level: 'error' | 'warn'; where: string; message: string }[] }>; log?: (line: string) => void }): Promise<void> {
  const { findings } = await input.validate();
  for (const finding of findings.filter((f) => f.level === 'warn').slice(0, 20)) input.log?.(`uyarı ${finding.where}: ${finding.message}`);
  const errors = findings.filter((f) => f.level === 'error');
  if (errors.length > 0) throw new Error(`doğrulama ${errors.length} hata buldu:\n${errors.slice(0, 10).map((f) => `${f.where}: ${f.message}`).join('\n')}`);
  promote(input.staging, input.outDir);
}

type StepInput = { plates: string[]; sources: Sources; workDir: string; outDir: string; pbf: string; python: string; run: Runner; repoRoot: string; keyDir?: string; bordersOut?: string; log?: (line: string) => void };

function filesUnder(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).sort().flatMap((name) => filesUnder(join(path, name)));
}

const fingerprint = (repoRoot: string, paths: string[]): string => {
  const hash = createHash('sha256');
  for (const path of paths) {
    const files = filesUnder(join(repoRoot, path));
    hash.update(`${path}:${files.length}\n`);
    for (const file of files) hash.update(file.slice(repoRoot.length)).update(readFileSync(file));
  }
  return hash.digest('hex').slice(0, 16);
};

export function buildSteps(input: StepInput): Step[] {
  const { plates, sources, workDir, outDir, repoRoot } = input;
  const all = plates.length === PLATES.length;
  const priority = plates.filter((p) => PRIORITY_PLATES.includes(p));
  const script = (name: string): string => join(repoRoot, 'pipeline', 'extract', name);
  const adminFull = join(workDir, 'admin-full.jsonl');
  const hoods = join(workDir, 'places-neighbourhood.jsonl');
  const filter = (list: string[]): string[] => (all ? [] : ['--provinces', list.join(',')]);
  const python = async (name: string, args: string[]): Promise<void> => {
    const { code, out } = await input.run(input.python, [script(name), ...args]);
    if (code !== 0) throw new Error(`${name}: ${out.slice(-600)}`);
  };
  const osm = sources.osmMd5;
  const extract = (names: string[]): string[] => names.map((n) => `pipeline/extract/${n}`);
  const boundaryCode = fingerprint(repoRoot, extract(['extract_admin.py', 'admin_pack.py', 'region_geojson.py', 'assign.py', 'common.py']));
  const boundaryKey = digest({ osm, boundaryCode });
  const textKey = digest({ osm, plates, boundaryKey });
  const addressesKey = digest({ textKey, code: fingerprint(repoRoot, extract(['extract_addresses.py'])) });
  const streetsKey = digest({ textKey, code: fingerprint(repoRoot, extract(['extract_street_parts.py'])) });
  const placesKey = digest({ textKey, code: fingerprint(repoRoot, [...extract(['extract_places.py']), 'pipeline/config/poi-kinds.json']) });
  const binalarKey = digest({ boundaryKey, priority, code: fingerprint(repoRoot, extract(['extract_buildings.py'])) });
  const businessKey = digest({ boundaryKey, plates, release: overtureRelease(), code: fingerprint(repoRoot, ['pipeline/extract/overture_places.py', 'pipeline/extract/chains.py', 'pipeline/extract/osm_chains.py', 'pipeline/extract/place_names.py', 'pipeline/extract/osm_names.py', 'pipeline/extract/building_index.py', 'src/native/map/abbreviate.ts', 'src/native/map/chains.json', 'pipeline/build/overture.ts', 'pipeline/build/places-annotate.ts', 'src/native/map/poi-glyphs.ts', 'pipeline/config/overture.json']), pbf: input.pbf });
  const directoryKey = digest({ businessKey, code: fingerprint(repoRoot, ['pipeline/build/directory.ts', 'pipeline/build/directory-read.ts', 'pipeline/build/address-pack.ts', 'src/core/text', 'src/core/region/geom.ts', 'src/core/geo/cells.ts', 'src/core/geo/distance.ts']) });
  const roadsKey = digest({ osm, plates, boundaryKey, code: fingerprint(repoRoot, extract(['extract_roads.py', 'road_rules.py'])) });
  const routeKey = digest({ roadsKey, code: fingerprint(repoRoot, ['pipeline/build/route-graph.ts', 'pipeline/build/route-turns.ts', 'pipeline/build/route-ch.ts', 'pipeline/build/route-scc.ts', 'pipeline/build/route-pack.ts', 'src/core/route', 'src/core/geo/distance.ts', 'src/core/region/data/borders.bin']) });
  const routeBorders = (): Borders => createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
  const packKey = digest({ addressesKey, streetsKey, placesKey, code: fingerprint(repoRoot, ['pipeline/build/address-pack.ts', 'src/core/text', 'src/core/region/geom.ts', 'src/core/geo/cells.ts', 'pipeline/config/poi-kinds.json']) });
  const steps: Step[] = [
    {
      name: 'sınırlar',
      key: boundaryKey,
      async run() {
        await python('extract_admin.py', [input.pbf, adminFull, '--full', '--places', hoods]);
        await python('admin_pack.py', [adminFull, join(workDir, 'admin-pack'), '--borders', join(workDir, 'borders.jsonl')]);
        await python('region_geojson.py', [adminFull, join(workDir, 'regions')]);
      },
    },
    { name: 'adresler', key: addressesKey, run: () => python('extract_addresses.py', [input.pbf, adminFull, hoods, join(workDir, 'addresses'), ...filter(plates)]) },
    { name: 'sokaklar', key: streetsKey, run: () => python('extract_street_parts.py', [input.pbf, adminFull, hoods, join(workDir, 'streets'), ...filter(plates)]) },
    { name: 'yerler', key: placesKey, run: () => python('extract_places.py', [input.pbf, adminFull, hoods, join(workDir, 'places'), ...filter(plates)]) },
  ];
  if (priority.length > 0) {
    steps.push({ name: 'binalar', key: binalarKey, run: () => python('extract_buildings.py', [input.pbf, adminFull, join(workDir, 'buildings'), '--provinces', priority.join(',')]) });
  }
  steps.push(
    {
      name: 'adres paketleri',
      key: packKey,
      async run() {
        for (const plate of plates) {
          mkdirSync(join(workDir, 'packs', plate), { recursive: true });
          const stats = await buildAddressPack({ province: plate, workDir, outFile: join(workDir, 'packs', plate, 'address.sqlite'), osmTimestamp: sources.osmTimestamp });
          writeAtomic(join(workDir, 'packs', plate, 'stats.json'), JSON.stringify(stats));
        }
      },
    },
    ...(priority.length > 0
      ? [
          {
            name: 'bina paketleri',
            key: digest({ binalarKey, packKey, code: fingerprint(repoRoot, ['pipeline/build/building-pack.ts', 'pipeline/build/building-select.ts', 'src/core/geo/cells.ts', 'src/core/region/geom.ts']) }),
            async run() {
              for (const plate of priority) {
                const result = await buildBuildingPack({ province: plate, workDir, addressFile: join(workDir, 'packs', plate, 'address.sqlite'), outFile: join(workDir, 'packs', plate, 'buildings.sqlite'), osmTimestamp: sources.osmTimestamp });
                input.log?.(`bina paketi ${plate}: ${result.written ? `${result.buildings} bina, ${result.bytes} bayt` : 'yazılmadı'} (merkez oranı ${result.ratio})`);
              }
            },
          },
        ]
      : []),
    {
      name: 'işletmeler',
      key: businessKey,
      async run() {
        await buildOverturePlaces({ release: overtureRelease(), plates, workDir, cacheDir: join(repoRoot, 'pipeline', 'data', 'overture'), python: input.python, script: script('overture_places.py'), borders: join(workDir, 'borders.jsonl'), pbf: input.pbf, run: input.run, log: input.log });
      },
    },
    {
      name: 'rehber paketleri',
      key: directoryKey,
      async run() {
        for (const plate of plates) {
          if (!existsSync(join(workDir, 'overture', `${plate}.rows.jsonl`))) continue;
          mkdirSync(join(workDir, 'packs', plate), { recursive: true });
          const stats = await buildDirectoryPack({ province: plate, workDir, outFile: join(workDir, 'packs', plate, 'directory.sqlite'), osmTimestamp: sources.osmTimestamp });
          writeAtomic(join(workDir, 'packs', plate, 'directory-stats.json'), JSON.stringify(stats));
          input.log?.(`rehber ${plate}: ${stats.rows} kapı, ${stats.places} yer, ${stats.bytes} bayt`);
        }
      },
    },
    {
      name: 'yollar',
      key: roadsKey,
      run: () => python('extract_roads.py', [input.pbf, adminFull, join(workDir, 'roads'), ...filter(plates)]),
    },
    {
      name: 'rota paketleri',
      key: routeKey,
      async run() {
        for (const plate of plates) {
          const rows = parseRoadRows(readFileSync(join(workDir, 'roads', plate, 'roads.jsonl'), 'utf8'));
          mkdirSync(join(workDir, 'packs', plate), { recursive: true });
          const { bytes, report } = buildRoutePack(rows, { ...graphOptionsFor({ ...PACK_OPTIONS, plate }, routeBorders()), plate });
          writeAtomic(join(workDir, 'packs', plate, 'route.bin'), bytes);
          writeAtomic(join(workDir, 'packs', plate, 'route-stats.json'), JSON.stringify(report));
          input.log?.(`rota ${plate}: ${report.baseNodes} kavşak, ${report.edges} yol parçası, ${report.bytes} bayt, ana ağ %${(report.mainShare * 100).toFixed(1)}`);
        }
      },
    },
    {
      name: 'gömülü sınırlar',
      key: digest({ boundaryKey, code: fingerprint(repoRoot, ['src/core/region/borders.ts', 'src/core/region/geom.ts', 'scripts/build-borders.ts']) }),
      async run() {
        const target = input.bordersOut ?? join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin');
        buildBordersFile(join(workDir, 'borders.jsonl'), target);
        if (!input.bordersOut) writeBordersModule(target, join(dirname(target), 'borders-base64.ts'));
      },
    },
    {
      name: 'karolar',
      key: digest({ build: sources.tilesBuild, plates, boundaryKey, code: fingerprint(repoRoot, ['pipeline/build/tiles.ts']) }),
      async run() {
        const budgets = Object.fromEntries((JSON.parse(readFileSync(join(repoRoot, 'fixtures', 'section3-door-counts.json'), 'utf8')) as { plate: string; tileMB: number }[]).map((r) => [r.plate, r.tileMB]));
        await buildBasePack({ build: sources.tilesBuild, outDir: join(workDir, `base-${sources.tilesBuild}`), run: input.run, ...(process.env.GEO_FONT === 'inter' ? { interDir: INTER_DIR } : {}) });
        await buildProvinceTiles({ regionsDir: join(workDir, 'regions'), outDir: join(workDir, `tiles-${sources.tilesBuild}`), build: sources.tilesBuild, plates, budgets, run: input.run, log: input.log });
      },
    },
    {
      name: 'doğrulama ve yayın',
      key: 'her seferinde',
      always: true,
      async run() {
        const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
        const names = new Map(adminData.provinces.map((p) => [p.plate, p.names as Record<string, string>]));
        const regions: RegionInput[] = plates.map((plate) => {
          const stats = JSON.parse(readFileSync(join(workDir, 'packs', plate, 'stats.json'), 'utf8')) as PackStats;
          const bbox = borders.provinceBounds(plate);
          if (!bbox) throw new Error(`${plate}: gömülü sınırlarda yok`);
          const provinceNames = names.get(plate);
          if (!provinceNames?.tr) throw new Error(`${plate}: il adı listede yok`);
          return {
            id: plate,
            tier: PRIORITY_PLATES.includes(plate) ? ('full' as const) : ('basic' as const),
            names: provinceNames,
            bbox,
            stats: { addresses: stats.rows, streets: stats.streets, neighbourhoods: stats.neighbourhoods },
            files: [
              { kind: 'address' as const, source: join(workDir, 'packs', plate, 'address.sqlite') },
              { kind: 'tiles' as const, source: join(workDir, `tiles-${sources.tilesBuild}`, `${plate}.pmtiles`) },
              ...(PRIORITY_PLATES.includes(plate) && existsSync(join(workDir, 'packs', plate, 'buildings.sqlite')) ? [{ kind: 'buildings' as const, source: join(workDir, 'packs', plate, 'buildings.sqlite') }] : []),
              ...(existsSync(join(workDir, 'overture', `${plate}.pmtiles`)) ? [{ kind: 'places' as const, source: join(workDir, 'overture', `${plate}.pmtiles`) }] : []),
              ...(existsSync(join(workDir, 'packs', plate, 'directory.sqlite')) ? [{ kind: 'directory' as const, source: join(workDir, 'packs', plate, 'directory.sqlite') }] : []),
              ...(existsSync(join(workDir, 'packs', plate, 'route.bin')) ? [{ kind: 'route' as const, source: join(workDir, 'packs', plate, 'route.bin') }] : []),
            ],
          };
        });
        const staging = `${outDir}.staging`;
        rmSync(staging, { recursive: true, force: true });
        const keyDir = input.keyDir ?? defaultKeyDir();
        await assemblePacks({ outDir: staging, sources, regions, baseDir: join(workDir, `base-${sources.tilesBuild}`), keyDir, minSdk: '0.3.0' });
        const publicKeyPem = ensureDevKey(keyDir).publicKeyPem;
        await finalizePublish({ staging, outDir, validate: () => validatePacks(staging, { run: input.run, work: workDir, publicKeyPem, borders }), log: input.log });
      },
    },
  );
  return steps;
}

export async function runBuild(input: StepInput & { markers?: string; force?: boolean }): Promise<BuildResult> {
  return runSteps(buildSteps({ ...input, run: input.run ?? defaultRunner }), { markers: input.markers ?? join(input.workDir, '.markers'), force: input.force, log: input.log });
}
