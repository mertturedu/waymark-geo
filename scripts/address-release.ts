import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemblePacks, defaultKeyDir, ensureDevKey, type RegionInput } from '../pipeline/build/manifest';
import { resolvePlates } from '../pipeline/build/orchestrate';
import { archivePack } from '../pipeline/build/patches';
import { PRIORITY_PLATES } from '../pipeline/build/tiles';
import { validatePacks } from '../pipeline/validate/validate-packs';
import { createBorders } from '../src/core/region/borders';
import adminData from '../src/core/text/data/admin.json';
import type { Sources } from './fetch-sources';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function main(): Promise<void> {
  const sources = JSON.parse(readFileSync(join(repoRoot, 'pipeline', 'data', 'sources.json'), 'utf8')) as Sources;
  const work = join(repoRoot, 'dist', 'work', sources.osmFile.slice(7, 13));
  const out = process.argv[2] ?? join(repoRoot, 'dist', 'packs-0.8-adres');
  const plates = resolvePlates('all');
  const names = new Map(adminData.provinces.map((p) => [p.plate, p.names as Record<string, string>]));
  const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
  const regions: RegionInput[] = plates.map((plate) => {
    const dir = join(work, 'packs', plate);
    const stats = JSON.parse(readFileSync(join(dir, 'stats.json'), 'utf8')) as { rows: number; streets: number; neighbourhoods: number };
    const part = (kind: RegionInput['files'][number]['kind'], file: string): RegionInput['files'] => (existsSync(join(dir, file)) ? [{ kind, source: join(dir, file) }] : []);
    return {
      id: plate,
      tier: PRIORITY_PLATES.includes(plate) ? ('full' as const) : ('basic' as const),
      names: names.get(plate) ?? { tr: plate },
      bbox: borders.provinceBounds(plate) as [number, number, number, number],
      stats: { addresses: stats.rows, streets: stats.streets, neighbourhoods: stats.neighbourhoods },
      files: [...part('address', 'address.sqlite'), ...(PRIORITY_PLATES.includes(plate) ? part('buildings', 'buildings.sqlite') : []), ...part('buildings2', 'buildings2.sqlite'), ...part('directory', 'directory.sqlite'), ...part('learned', 'learned.sqlite')],
    };
  });
  const archive = join(work, 'address-release-archive');
  const previous = process.env.PREVIOUS_AS;
  if (previous && existsSync(join(out, 'manifest-v1.json'))) {
    const version = archivePack(out, archive);
    if (version && version !== previous && !existsSync(join(archive, previous))) renameSync(join(archive, version), join(archive, previous));
  }
  rmSync(out, { recursive: true, force: true });
  const base = join(work, 'address-release-base');
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const started = Date.now();
  const keyDir = defaultKeyDir();
  const patching = existsSync(archive) ? { archiveDir: archive, cacheDir: join(work, 'address-release-cache'), tmpDir: join(work, 'address-release-tmp'), keep: 3 } : undefined;
  if (patching) {
    mkdirSync(patching.cacheDir, { recursive: true });
    mkdirSync(patching.tmpDir, { recursive: true });
  }
  const result = await assemblePacks({ outDir: out, sources, regions, baseDir: base, keyDir, minSdk: '0.3.0', ...(patching ? { patches: patching } : {}) });
  const seconds = Math.round((Date.now() - started) / 1000);
  const { publicKeyPem } = ensureDevKey(keyDir);
  const validated = await validatePacks(out, { publicKeyPem, borders });
  const errors = validated.findings.filter((f) => f.level === 'error');
  const sizes: Record<string, { files: number; raw: number; sent: number }> = {};
  for (const file of ['manifest-v1.json', 'manifest-v2.json']) sizes[file] = { files: 1, raw: statSync(join(out, file)).size, sent: statSync(join(out, file)).size };
  const manifest = JSON.parse(readFileSync(join(out, 'manifest-v2.json'), 'utf8')) as { regions: { files: { kind: string; size: number; encoded?: { size: number } }[] }[] };
  const perKind: Record<string, { files: number; raw: number; sent: number }> = {};
  for (const r of manifest.regions) for (const f of r.files) {
    const e = (perKind[f.kind] ??= { files: 0, raw: 0, sent: 0 });
    e.files += 1;
    e.raw += f.size;
    e.sent += f.encoded?.size ?? f.size;
  }
  const report = { out, seconds, files: result.files, patchStats: result.patchStats ?? null, errors: errors.length, warnings: validated.findings.length - errors.length, summary: validated.summary, perKind, manifests: sizes };
  writeFileSync(join(work, 'address-release.json'), JSON.stringify({ ...report, findings: validated.findings.slice(0, 40) }, null, 1));
  console.log(JSON.stringify(report));
  for (const f of errors.slice(0, 15)) console.log(`HATA ${f.where}: ${f.message}`);
  process.exit(errors.length === 0 ? 0 : 1);
}

void main();
