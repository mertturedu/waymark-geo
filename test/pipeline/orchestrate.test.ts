import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSteps, describePatches, finalizePublish, preparePatches, promote, resolvePlates, runSteps, writeAtomic, type Step } from '../../pipeline/build/orchestrate';
import type { Runner } from '../../pipeline/build/tiles';

const sources = { osmFile: 'turkey-261020.osm.pbf', osmMd5: 'a'.repeat(32), osmTimestamp: '2026-10-20T20:23:47Z', tilesBuild: '20261022', tilesOsmTime: '2026-10-22T04:00:00Z' };

describe('resolvePlates', () => {
  it('knows the twelve priority provinces, all eighty one and a list', () => {
    expect(resolvePlates('12il')).toEqual(['06', '10', '16', '20', '34', '35', '38', '41', '42', '45', '58', '59']);
    expect(resolvePlates('all')).toHaveLength(81);
    expect(resolvePlates('all')[0]).toBe('01');
    expect(resolvePlates('all')[80]).toBe('81');
    expect(resolvePlates('34,06')).toEqual(['06', '34']);
    expect(resolvePlates('6,34')).toEqual(['06', '34']);
  });

  it.each(['00', '82', 'ab', '', '34,99', '34,34'])('refuses %j', (text) => {
    expect(() => resolvePlates(text)).toThrow();
  });
});

describe('runSteps', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'steps-'));
  const step = (name: string, log: string[], fail = false, key = 'k'): Step => ({
    name,
    key,
    async run() {
      log.push(name);
      if (fail) throw new Error(`${name} kırıldı`);
    },
  });

  it('runs the steps in the given order and reports how long each took', async () => {
    const log: string[] = [];
    const result = await runSteps([step('a', log), step('b', log), step('c', log)], { markers: dir() });
    expect(log).toEqual(['a', 'b', 'c']);
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.name)).toEqual(['a', 'b', 'c']);
    expect(result.steps.every((s) => s.ms >= 0 && s.skipped === false)).toBe(true);
  });

  it('stops at the first broken step and says which one', async () => {
    const log: string[] = [];
    const result = await runSteps([step('a', log), step('b', log, true), step('c', log)], { markers: dir() });
    expect(log).toEqual(['a', 'b']);
    expect(result.ok).toBe(false);
    expect(result.failed).toEqual({ name: 'b', message: 'b kırıldı' });
    expect(result.steps.map((s) => s.name)).toEqual(['a']);
  });

  it('skips a step that finished before with the same input and runs it again when the input changed or when forced', async () => {
    const markers = dir();
    const log: string[] = [];
    await runSteps([step('a', log), step('b', log)], { markers });
    await runSteps([step('a', log), step('b', log)], { markers });
    expect(log).toEqual(['a', 'b']);
    await runSteps([step('a', log), step('b', log, false, 'new')], { markers });
    expect(log).toEqual(['a', 'b', 'b']);
    await runSteps([step('a', log), step('b', log)], { markers, force: true });
    expect(log).toEqual(['a', 'b', 'b', 'a', 'b']);
  });

  it('does not remember a step that failed', async () => {
    const markers = dir();
    const log: string[] = [];
    await runSteps([step('a', log, true)], { markers });
    await runSteps([step('a', log)], { markers });
    expect(log).toEqual(['a', 'a']);
  });
});

describe('buildSteps', () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const run: Runner = async (cmd, args) => {
    calls.push({ cmd, args });
    return { code: 0, out: '' };
  };
  const make = (regions: string) => buildSteps({ plates: resolvePlates(regions), sources, workDir: '/w', outDir: '/o', pbf: '/data/turkey.osm.pbf', python: '/py', run, repoRoot: '/repo' });

  it('lists the steps in the order of the plan', () => {
    expect(make('12il').map((s) => s.name)).toEqual(['sınırlar', 'adresler', 'sokaklar', 'yerler', 'binalar', 'işletmeler', 'adsız yollar', 'sokak adları', 'bina izleri', 'ulusal omurga', 'adres paketleri', 'bina paketleri 2', 'bina paketleri', 'rehber paketleri', 'yollar', 'rota paketleri', 'gömülü sınırlar', 'karolar', 'karo budama', 'karo kodlama', 'doğrulama ve yayın']);
  });

  it('leaves out the building points when no priority province is asked for', () => {
    expect(make('01,02').map((s) => s.name)).not.toContain('binalar');
    expect(make('01,02').map((s) => s.name)).not.toContain('bina paketleri');
    expect(make('34,01').map((s) => s.name)).toContain('binalar');
    expect(make('34,01').map((s) => s.name)).toContain('bina paketleri');
  });

  it('changes the key of a step when what it depends on changes', () => {
    const a = make('34');
    const b = make('34,06');
    const keyOf = (steps: Step[], name: string): string => steps.find((s) => s.name === name)?.key as string;
    expect(keyOf(a, 'sınırlar')).toBe(keyOf(b, 'sınırlar'));
    expect(keyOf(a, 'adresler')).not.toBe(keyOf(b, 'adresler'));
    expect(keyOf(a, 'karolar')).not.toBe(keyOf(b, 'karolar'));
  });

  it('calls the Python scripts with the files in the work folder', async () => {
    calls.length = 0;
    const steps = make('34,06');
    for (const name of ['sınırlar', 'adresler', 'sokaklar', 'yerler', 'binalar']) await steps.find((s) => s.name === name)?.run();
    const scripts = calls.map((c) => `${c.cmd} ${c.args[0]?.split('/').pop()}`);
    expect(scripts).toEqual([
      '/py extract_admin.py', '/py admin_pack.py', '/py region_geojson.py', '/py extract_addresses.py', '/py extract_street_parts.py', '/py extract_places.py', '/py extract_buildings.py',
    ]);
    const addresses = calls.find((c) => c.args[0]?.endsWith('extract_addresses.py'));
    expect(addresses?.args).toEqual(['/repo/pipeline/extract/extract_addresses.py', '/data/turkey.osm.pbf', '/w/admin-full.jsonl', '/w/places-neighbourhood.jsonl', '/w/addresses', '--provinces', '06,34']);
    const buildings = calls.find((c) => c.args[0]?.endsWith('extract_buildings.py'));
    expect(buildings?.args.slice(-2)).toEqual(['--provinces', '06,34']);
  });

  it('leaves the province filter off when all provinces are asked for', async () => {
    calls.length = 0;
    const steps = make('all');
    await steps.find((s) => s.name === 'adresler')?.run();
    expect(calls[0]?.args).not.toContain('--provinces');
  });

  it('turns a failing script into an error that carries its output', async () => {
    const failing = buildSteps({ plates: ['34'], sources, workDir: '/w', outDir: '/o', pbf: '/p', python: '/py', run: async () => ({ code: 1, out: 'Traceback: patladı' }), repoRoot: '/repo' });
    await expect(failing[0]?.run()).rejects.toThrow(/patladı/);
  });
});

describe('step keys follow everything a step reads', () => {
  const FILES = [
    'pipeline/extract/extract_admin.py', 'pipeline/extract/admin_pack.py', 'pipeline/extract/region_geojson.py', 'pipeline/extract/assign.py', 'pipeline/extract/common.py',
    'pipeline/extract/extract_addresses.py', 'pipeline/extract/extract_street_parts.py', 'pipeline/extract/extract_places.py', 'pipeline/extract/extract_buildings.py', 'pipeline/extract/overture_places.py', 'pipeline/build/overture.ts', 'pipeline/config/overture.json', 'pipeline/build/directory.ts', 'pipeline/build/directory-read.ts', 'src/core/geo/distance.ts', 'pipeline/extract/extract_roads.py', 'pipeline/extract/road_rules.py', 'pipeline/build/route-graph.ts', 'pipeline/build/route-turns.ts', 'pipeline/build/route-ch.ts', 'pipeline/build/route-scc.ts', 'pipeline/build/route-pack.ts', 'src/core/route/speeds.ts', 'src/core/region/data/borders.bin',
    'pipeline/config/poi-kinds.json', 'pipeline/build/address-pack.ts', 'pipeline/build/admin-national.ts', 'pipeline/build/admin-national-step.ts', 'pipeline/build/sid.ts', 'pipeline/data/official/units.json', 'pipeline/build/tiles.ts', 'src/core/text/street.ts', 'src/core/text/data/admin.json', 'src/core/region/geom.ts',
    'src/core/region/borders.ts', 'scripts/build-borders.ts', 'pipeline/build/building-pack.ts', 'pipeline/build/building-select.ts', 'pipeline/build/building-pack2.ts', 'pipeline/build/building-pack-v2.ts', 'pipeline/build/building-link.ts', 'src/core/address/buildings2.ts', 'pipeline/extract/extract_building_traces.py', 'pipeline/extract/extract_osm_building_tags.py', 'pipeline/extract/extract_unnamed_roads.py', 'pipeline/build/street-names.ts', 'pipeline/build/street-names-step.ts', 'src/core/address/names.ts', 'src/core/geo/cells.ts', 'README.md',
    'pipeline/build/tile-prune.ts', 'pipeline/build/tile-usage.ts', 'pipeline/build/mvt.ts', 'pipeline/build/pmtiles-file.ts', 'src/native/map/style.ts', 'pipeline/build/tile-encode.ts', 'pipeline/tools.lock.json',
  ];
  const repo = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'keys-'));
    for (const file of FILES) {
      mkdirSync(join(dir, file, '..'), { recursive: true });
      writeFileSync(join(dir, file), `v1 ${file}`);
    }
    return dir;
  };
  const keys = (root: string): Record<string, string> =>
    Object.fromEntries(buildSteps({ plates: resolvePlates('34,06'), sources, workDir: '/w', outDir: '/o', pbf: '/p', python: '/py', run: async () => ({ code: 0, out: '' }), repoRoot: root }).map((s) => [s.name, s.key]));
  const changed = (file: string): string[] => {
    const root = repo();
    const before = keys(root);
    writeFileSync(join(root, file), 'v2');
    const after = keys(root);
    return Object.keys(before).filter((name) => before[name] !== after[name]);
  };

  it.each([
    ['pipeline/extract/extract_admin.py', ['sınırlar', 'adresler', 'sokaklar', 'yerler', 'binalar', 'işletmeler', 'adsız yollar', 'sokak adları', 'adres paketleri', 'bina izleri', 'bina paketleri 2', 'bina paketleri', 'rehber paketleri', 'yollar', 'rota paketleri', 'gömülü sınırlar', 'karolar', 'karo budama', 'karo kodlama', 'ulusal omurga']],
    ['pipeline/extract/admin_pack.py', ['sınırlar', 'adresler', 'sokaklar', 'yerler', 'binalar', 'işletmeler', 'adsız yollar', 'sokak adları', 'adres paketleri', 'bina izleri', 'bina paketleri 2', 'bina paketleri', 'rehber paketleri', 'yollar', 'rota paketleri', 'gömülü sınırlar', 'karolar', 'karo budama', 'karo kodlama', 'ulusal omurga']],
    ['pipeline/extract/extract_roads.py', ['yollar', 'rota paketleri']],
    ['pipeline/extract/road_rules.py', ['yollar', 'rota paketleri']],
    ['pipeline/build/route-graph.ts', ['rota paketleri']],
    ['pipeline/build/route-turns.ts', ['rota paketleri']],
    ['pipeline/build/route-ch.ts', ['rota paketleri']],
    ['pipeline/build/route-scc.ts', ['rota paketleri']],
    ['pipeline/build/route-pack.ts', ['rota paketleri']],
    ['src/core/route/speeds.ts', ['rota paketleri']],
    ['src/core/region/data/borders.bin', ['rota paketleri']],
    ['pipeline/extract/extract_addresses.py', ['adresler', 'sokak adları', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'karo budama', 'karo kodlama']],
    ['pipeline/extract/extract_street_parts.py', ['sokak adları', 'sokaklar', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'karo budama', 'karo kodlama']],
    ['pipeline/extract/extract_places.py', ['yerler', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'karo budama', 'karo kodlama']],
    ['pipeline/config/poi-kinds.json', ['yerler', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'karo budama', 'karo kodlama']],
    ['pipeline/extract/extract_buildings.py', ['binalar', 'bina paketleri']],
    ['pipeline/build/address-pack.ts', ['adres paketleri', 'bina paketleri', 'bina paketleri 2', 'rehber paketleri', 'karo budama', 'karo kodlama']],
    ['pipeline/build/directory.ts', ['rehber paketleri']],
    ['pipeline/build/directory-read.ts', ['rehber paketleri']],
    ['src/core/geo/distance.ts', ['rehber paketleri', 'rota paketleri']],
    ['pipeline/build/building-pack.ts', ['bina paketleri']],
    ['pipeline/extract/extract_unnamed_roads.py', ['adsız yollar', 'sokak adları', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'karo budama', 'karo kodlama']],
    ['pipeline/build/admin-national.ts', ['ulusal omurga', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'karo budama', 'karo kodlama']],
    ['pipeline/build/admin-national-step.ts', ['ulusal omurga', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'karo budama', 'karo kodlama']],
    ['pipeline/build/sid.ts', ['ulusal omurga', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'karo budama', 'karo kodlama']],
    ['pipeline/data/official/units.json', ['ulusal omurga', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'karo budama', 'karo kodlama']],
    ['pipeline/build/street-names.ts', ['sokak adları', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'karo budama', 'karo kodlama']],
    ['pipeline/build/street-names-step.ts', ['sokak adları', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'karo budama', 'karo kodlama']],
    ['src/core/address/names.ts', ['sokak adları', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'karo budama', 'karo kodlama', 'ulusal omurga']],
    ['pipeline/build/building-pack2.ts', ['bina paketleri 2']],
    ['pipeline/build/building-pack-v2.ts', ['bina paketleri 2']],
    ['pipeline/build/building-link.ts', ['bina paketleri 2']],
    ['src/core/address/buildings2.ts', ['bina paketleri 2']],
    ['pipeline/extract/extract_building_traces.py', ['bina izleri', 'bina paketleri 2', 'ulusal omurga', 'adres paketleri', 'bina paketleri', 'karo budama', 'karo kodlama']],
    ['pipeline/extract/extract_osm_building_tags.py', ['bina izleri', 'bina paketleri 2', 'ulusal omurga', 'adres paketleri', 'bina paketleri', 'karo budama', 'karo kodlama']],
    ['pipeline/build/building-select.ts', ['bina paketleri']],
    ['src/core/geo/cells.ts', ['adres paketleri', 'bina paketleri', 'bina paketleri 2', 'rehber paketleri', 'karo budama', 'karo kodlama']],
    ['src/core/text/street.ts', ['sokak adları', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'rehber paketleri', 'karo budama', 'karo kodlama', 'ulusal omurga']],
    ['src/core/text/data/admin.json', ['sokak adları', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'rehber paketleri', 'karo budama', 'karo kodlama', 'ulusal omurga']],
    ['src/core/region/geom.ts', ['adres paketleri', 'bina paketleri', 'bina paketleri 2', 'rehber paketleri', 'gömülü sınırlar', 'karo budama', 'karo kodlama']],
    ['src/core/region/borders.ts', ['gömülü sınırlar']],
    ['scripts/build-borders.ts', ['gömülü sınırlar']],
    ['pipeline/build/tiles.ts', ['karolar', 'karo budama', 'karo kodlama']],
    ['pipeline/extract/overture_places.py', ['sokak adları', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'işletmeler', 'rehber paketleri', 'karo budama', 'karo kodlama']],
    ['pipeline/build/overture.ts', ['sokak adları', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'işletmeler', 'rehber paketleri', 'karo budama', 'karo kodlama']],
    ['pipeline/config/overture.json', ['sokak adları', 'adres paketleri', 'bina paketleri', 'bina paketleri 2', 'işletmeler', 'rehber paketleri', 'karo budama', 'karo kodlama']],
    ['pipeline/build/tile-prune.ts', ['karo budama', 'karo kodlama']],
    ['pipeline/build/tile-usage.ts', ['karo budama', 'karo kodlama']],
    ['pipeline/build/mvt.ts', ['karo budama', 'karo kodlama']],
    ['pipeline/build/pmtiles-file.ts', ['karo budama', 'karo kodlama']],
    ['src/native/map/style.ts', ['karo budama', 'karo kodlama']],
    ['README.md', []],
  ])('a change in %s moves exactly the steps that depend on it', (file, steps) => {
    expect(changed(file).sort()).toEqual([...steps].sort());
  });
});

describe('embedded borders step', () => {
  it('writes the borders file to the place it is told to', async () => {
    const work = mkdtempSync(join(tmpdir(), 'bstep-'));
    writeFileSync(join(work, 'borders.jsonl'), JSON.stringify({ plate: '34', rings: [[[[28.5, 40.5], [29.5, 40.5], [29.5, 41.5], [28.5, 41.5], [28.5, 40.5]]]] }) + '\n');
    const target = join(work, 'out', 'borders.bin');
    mkdirSync(join(work, 'out'));
    const steps = buildSteps({ plates: ['34'], sources, workDir: work, outDir: '/o', pbf: '/p', python: '/py', run: async () => ({ code: 0, out: '' }), repoRoot: '/repo', bordersOut: target });
    await steps.find((s) => s.name === 'gömülü sınırlar')?.run();
    expect(existsSync(target)).toBe(true);
  });
});

describe('promote', () => {
  const make = () => {
    const base = mkdtempSync(join(tmpdir(), 'promote-'));
    const staging = join(base, 'packs.staging');
    const out = join(base, 'packs');
    mkdirSync(staging);
    mkdirSync(out);
    writeFileSync(join(staging, 'manifest-v1.json'), 'yeni');
    writeFileSync(join(out, 'manifest-v1.json'), 'eski');
    return { base, staging, out };
  };

  it('replaces the published folder by the staged one and leaves nothing behind', () => {
    const { base, staging, out } = make();
    promote(staging, out);
    expect(readFileSync(join(out, 'manifest-v1.json'), 'utf8')).toBe('yeni');
    expect(existsSync(staging)).toBe(false);
    expect(existsSync(join(base, 'packs.old'))).toBe(false);
  });

  it('works when nothing was published before', () => {
    const { staging, out } = make();
    promote(staging, join(out, 'sub'));
    expect(readFileSync(join(out, 'sub', 'manifest-v1.json'), 'utf8')).toBe('yeni');
  });

  it('keeps the published folder when there is nothing staged', () => {
    const { base, staging, out } = make();
    expect(() => promote(join(base, 'yok'), out)).toThrow();
    expect(readFileSync(join(out, 'manifest-v1.json'), 'utf8')).toBe('eski');
    expect(existsSync(staging)).toBe(true);
  });
});

describe('finalizePublish', () => {
  const make = () => {
    const base = mkdtempSync(join(tmpdir(), 'final-'));
    const staging = join(base, 'packs.staging');
    const out = join(base, 'packs');
    mkdirSync(staging);
    mkdirSync(out);
    writeFileSync(join(staging, 'manifest-v1.json'), 'yeni');
    writeFileSync(join(out, 'manifest-v1.json'), 'eski');
    return { staging, out };
  };
  const finding = (level: 'error' | 'warn', message: string) => ({ level, where: 'x', message });

  it('publishes when validation finds no error and reports the warnings it saw', async () => {
    const { staging, out } = make();
    const seen: string[] = [];
    await finalizePublish({ staging, outDir: out, validate: async () => ({ findings: [finding('warn', 'küçük şey')], summary: {} }), log: (l) => seen.push(l) });
    expect(readFileSync(join(out, 'manifest-v1.json'), 'utf8')).toBe('yeni');
    expect(seen.join('\n')).toContain('küçük şey');
  });

  it('keeps the published set and the staged one when validation finds an error', async () => {
    const { staging, out } = make();
    await expect(finalizePublish({ staging, outDir: out, validate: async () => ({ findings: [finding('error', 'sha bozuk'), finding('warn', 'w')], summary: {} }) })).rejects.toThrow(/1 hata[\s\S]*sha bozuk/);
    expect(readFileSync(join(out, 'manifest-v1.json'), 'utf8')).toBe('eski');
    expect(existsSync(staging)).toBe(true);
  });

  it('lists at most ten errors in the message', async () => {
    const { staging, out } = make();
    const many = Array.from({ length: 25 }, (_, i) => finding('error', `hata ${i}`));
    await expect(finalizePublish({ staging, outDir: out, validate: async () => ({ findings: many, summary: {} }) })).rejects.toThrow(/25 hata[\s\S]*hata 9/);
    await finalizePublish({ staging, outDir: out, validate: async () => ({ findings: [], summary: {} }) });
  });
});

describe('promote after a crash', () => {
  it('puts the old set back first when only the old copy is left', () => {
    const base = mkdtempSync(join(tmpdir(), 'crash-'));
    const old = join(base, 'packs.old');
    const staging = join(base, 'packs.staging');
    mkdirSync(old);
    mkdirSync(staging);
    writeFileSync(join(old, 'manifest-v1.json'), 'eski');
    expect(() => promote(join(base, 'yok'), join(base, 'packs'))).toThrow();
    expect(readFileSync(join(base, 'packs', 'manifest-v1.json'), 'utf8')).toBe('eski');
  });
});

describe('writeAtomic', () => {
  it('leaves the whole text and no temporary file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-'));
    writeAtomic(join(dir, 'a.json'), '{"x":1}');
    writeAtomic(join(dir, 'a.json'), '{"x":2}');
    expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe('{"x":2}');
    expect(existsSync(join(dir, 'a.json.tmp'))).toBe(false);
  });
});

describe('preparePatches', () => {
  const sources = { osmFile: 'turkey-261028.osm.pbf', osmMd5: 'a'.repeat(32), osmTimestamp: '2026-10-28T20:00:00Z', tilesBuild: '20261030', tilesOsmTime: '2026-10-30T04:00:00Z' };
  const published = (root: string, version: string): string => {
    const out = join(root, 'packs');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'manifest-v1.json'), JSON.stringify({ format: 1, minSdk: '0.5.0', osm: { file: 'a', time: 't' }, tiles: { build: '20261030', time: 't' }, base: [], regions: [{ id: '34', tier: 'full', names: { tr: 'İstanbul' }, bbox: [28, 40, 30, 42], version, stats: { addresses: 1, streets: 1, neighbourhoods: 1 }, files: [{ kind: 'address', path: '34/a.sqlite', size: 3, sha256: 'a'.repeat(64) }] }] }));
    mkdirSync(join(out, '34'), { recursive: true });
    writeFileSync(join(out, '34', 'a.sqlite'), 'abc');
    return out;
  };
  const withEnv = async (value: string | undefined, run: () => void | Promise<void>): Promise<void> => {
    const was = process.env.GEO_PATCHES;
    if (value === undefined) delete process.env.GEO_PATCHES;
    else process.env.GEO_PATCHES = value;
    try {
      await run();
    } finally {
      if (was === undefined) delete process.env.GEO_PATCHES;
      else process.env.GEO_PATCHES = was;
    }
  };

  it('archives the published pack and returns where patches come from and go', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prep-'));
    const outDir = published(root, '20261020.20261022');
    await withEnv(undefined, () => {
      const plan = preparePatches({ outDir, workDir: join(root, 'work'), sources });
      expect(plan).toMatchObject({ archiveDir: join(root, 'archive'), cacheDir: join(root, 'work', 'patch-cache'), tmpDir: join(root, 'work', 'patch-tmp'), keep: 3, exclude: '20261028.20261030' });
      expect(existsSync(join(root, 'archive', '20261020.20261022', '34', 'a.sqlite'))).toBe(true);
    });
  });

  it('does not archive or prune a pack of the version being built', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prep-'));
    const outDir = published(root, '20261028.20261030');
    await withEnv('2', () => {
      expect(preparePatches({ outDir, workDir: join(root, 'work'), sources })).toMatchObject({ keep: 2 });
    });
  });

  it('keeps only the newest versions in the archive', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prep-'));
    for (const version of ['20261001.20261002', '20261010.20261011', '20261015.20261016']) {
      const out = published(root, version);
      await withEnv('2', () => void preparePatches({ outDir: out, workDir: join(root, 'work'), sources, log: () => undefined }));
      rmSync(out, { recursive: true, force: true });
    }
    expect(readdirSync(join(root, 'archive')).sort()).toEqual(['20261010.20261011', '20261015.20261016']);
  });

  it('switches everything off with GEO_PATCHES=0', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prep-'));
    const outDir = published(root, '20261020.20261022');
    await withEnv('0', () => {
      expect(preparePatches({ outDir, workDir: join(root, 'work'), sources })).toBeUndefined();
      expect(existsSync(join(root, 'archive'))).toBe(false);
    });
  });

  it('describes the outcome in one line', () => {
    expect(describePatches({ made: 2, cached: 1, tooBig: 3, unverified: 0, skippedSmall: 4, bytes: 12_500_000, ms: 4500 })).toBe('yamalar: 2 yeni, 1 önbellekten, 3 büyük olduğu için atlandı, 0 tutmadı, 12.5 MB, 4.5 sn');
  });
});
