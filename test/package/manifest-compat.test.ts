import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { buildAddressPack } from '../../pipeline/build/address-pack';
import { assemblePacks } from '../../pipeline/build/manifest';
import { parseManifest } from '../../src/core/region/manifest';
import { baseRows, writeWork } from '../pipeline/helpers/mini-work';

const sources = { osmFile: 'turkey-261020.osm.pbf', osmMd5: 'a'.repeat(32), osmTimestamp: '2026-10-20T20:23:47Z', tilesBuild: '20261022', tilesOsmTime: '2026-10-22T04:00:00Z' };

function oldParser(): ((text: string) => { regions: { files: { kind: string }[] }[] }) | null {
  try {
    const source = execFileSync('git', ['show', 'v0.7.2:src/core/region/manifest.ts'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const sandbox = { exports: {} as { parseManifest?: (text: string) => { regions: { files: { kind: string }[] }[] } } };
    vm.runInNewContext(js, { exports: sandbox.exports, module: { exports: sandbox.exports } });
    return sandbox.exports.parseManifest ?? null;
  } catch {
    return null;
  }
}

async function release(): Promise<string> {
  const work = writeWork(baseRows());
  const pack = join(work, 'pack.sqlite');
  const stats = await buildAddressPack({ province: '34', workDir: work, outFile: pack, osmTimestamp: sources.osmTimestamp });
  const tiles = join(work, 'tiles.pmtiles');
  const buildings = join(work, 'buildings2.sqlite');
  writeFileSync(tiles, 'karo dosyası');
  writeFileSync(buildings, 'bina paketi');
  const baseDir = join(work, 'base');
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(join(baseDir, 'overview.pmtiles'), 'genel harita');
  const out = join(mkdtempSync(join(tmpdir(), 'compat-')), 'packs');
  await assemblePacks({ outDir: out, sources, regions: [{ id: '34', tier: 'full', names: { tr: 'İstanbul' }, bbox: [28.4, 40.4, 29.6, 41.6], stats: { addresses: stats.rows, streets: stats.streets, neighbourhoods: stats.neighbourhoods }, files: [{ kind: 'address', source: pack }, { kind: 'tiles', source: tiles }, { kind: 'buildings2', source: buildings }] }], baseDir, keyDir: join(work, 'keys'), minSdk: '0.3.0', compress: false });
  return out;
}

describe('the 0.7.2 SDK against the manifests of this build', () => {
  const old = oldParser();
  const it0 = old ? it : it.skip;

  it0('reads manifest-v1 and sees none of the new kinds', async () => {
    const root = await release();
    const parsed = (old as NonNullable<typeof old>)(readFileSync(join(root, 'manifest-v1.json'), 'utf8'));
    expect(parsed.regions[0]?.files.map((f) => f.kind)).toEqual(['address', 'tiles']);
  });

  it0('cannot read manifest-v2, which is why it is a different file that the old SDK never asks for', async () => {
    const root = await release();
    expect(() => (old as NonNullable<typeof old>)(readFileSync(join(root, 'manifest-v2.json'), 'utf8'))).toThrow(/biçim sürümü desteklenmiyor/);
  });

  it('keeps the new SDK able to read both manifests of the same release', async () => {
    const root = await release();
    expect(parseManifest(readFileSync(join(root, 'manifest-v1.json'), 'utf8')).regions[0]?.files.map((f) => f.kind)).toEqual(['address', 'tiles']);
    expect(parseManifest(readFileSync(join(root, 'manifest-v2.json'), 'utf8')).regions[0]?.files.map((f) => f.kind)).toEqual(['address', 'buildings2', 'tiles']);
  });
});
