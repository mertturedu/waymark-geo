import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PRIORITY_PLATES, baseAssets, defaultRunner, buildBasePack, buildProvinceTiles, extractArgs, extractProvinceTiles, parseArchiveMb, parseBounds, sourceUrl, type Runner } from '../../pipeline/build/tiles';

const SHOW = `pmtiles spec version: 3
tile type: mvt
bounds: (long: 29.000000, lat: 40.960000) (long: 29.100000, lat: 41.040000)
min zoom: 0
max zoom: 15
`;

type Call = { cmd: string; args: string[] };

function fakeRunner(options: { dryMb?: number; extractCode?: number; failFirst?: number; dryFailFirst?: number; verifyCode?: number; show?: string } = {}): { run: Runner; calls: Call[] } {
  const calls: Call[] = [];
  let failures = options.failFirst ?? 0;
  let dryFailures = options.dryFailFirst ?? 0;
  const run: Runner = async (cmd, args) => {
    calls.push({ cmd, args });
    if (args[0] === 'extract') {
      if (args.includes('--dry-run') && dryFailures > 0) {
        dryFailures -= 1;
        return { code: 124, out: 'zaman aşımı' };
      }
      if (args.includes('--dry-run')) return { code: 0, out: `Extract transferred 5 MB (overfetch 0.05) for an archive size of ${options.dryMb ?? 6.4} MB\n` };
      if (failures > 0) {
        failures -= 1;
        return { code: 1, out: 'connection reset by peer' };
      }
      if ((options.extractCode ?? 0) !== 0) return { code: options.extractCode ?? 1, out: 'boom' };
      const target = args[2] as string;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, 'pmtiles-bytes');
      return { code: 0, out: '' };
    }
    if (args[0] === 'verify') return { code: options.verifyCode ?? 0, out: '' };
    if (args[0] === 'show') return { code: 0, out: options.show ?? SHOW };
    return { code: 127, out: 'unknown' };
  };
  return { run, calls };
}

describe('output parsers', () => {
  it('reads the archive size a dry run prints', () => {
    expect(parseArchiveMb('2026/10/23 extract.go:612: Extract transferred 45 MB (overfetch 0.05) for an archive size of 43 MB')).toBe(43);
    expect(parseArchiveMb('... for an archive size of 6.4 MB')).toBe(6.4);
    expect(parseArchiveMb('nothing here')).toBeNull();
  });

  it('reads the header bounds as west, south, east, north', () => {
    expect(parseBounds(SHOW)).toEqual([29, 40.96, 29.1, 41.04]);
    expect(parseBounds('tile type: mvt')).toBeNull();
  });
});

describe('extractArgs', () => {
  it('builds the region extract command for a build', () => {
    expect(sourceUrl('20261022')).toBe('https://build.protomaps.com/20261022.pmtiles');
    expect(extractArgs(sourceUrl('20261022'), '/o/34.pmtiles', '/r/34.geojson')).toEqual([
      'extract', 'https://build.protomaps.com/20261022.pmtiles', '/o/34.pmtiles', '--region=/r/34.geojson', '--maxzoom=15',
    ]);
  });
});

describe('extractProvinceTiles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiles-'));
  const input = (plate: string, run: Runner, budgetMb = 80) => ({ plate, build: '20261022', geojson: join(dir, plate + '.geojson'), outFile: join(dir, 'out', plate + '.pmtiles'), budgetMb, run });

  it('sizes the extract first, extracts to a temporary name, verifies, then renames', async () => {
    const { run, calls } = fakeRunner();
    const result = await extractProvinceTiles(input('34', run));
    expect(calls.map((c) => c.args[0] + (c.args.includes('--dry-run') ? ':dry' : ''))).toEqual(['extract:dry', 'extract', 'verify', 'show']);
    expect(calls[1]?.args[2]).toMatch(/34\.pmtiles\.tmp$/);
    expect(result).toEqual({ bytes: 13, bounds: [29, 40.96, 29.1, 41.04] });
    expect(existsSync(join(dir, 'out', '34.pmtiles'))).toBe(true);
    expect(existsSync(join(dir, 'out', '34.pmtiles.tmp'))).toBe(false);
  });

  it('stops before downloading when the dry run is over the budget', async () => {
    const { run, calls } = fakeRunner({ dryMb: 95 });
    await expect(extractProvinceTiles(input('35', run, 75))).rejects.toThrow(/35.*95.*75/);
    expect(calls).toHaveLength(1);
    expect(existsSync(join(dir, 'out', '35.pmtiles'))).toBe(false);
  });

  it('leaves no file behind when the extract fails', async () => {
    const { run } = fakeRunner({ extractCode: 1 });
    await expect(extractProvinceTiles({ ...input('06', run), pauseMs: 0 })).rejects.toThrow(/boom/);
    expect(readdirSync(join(dir, 'out')).filter((n) => n.startsWith('06'))).toEqual([]);
  });

  it('tries a broken download again and gives up after three attempts', async () => {
    const flaky = fakeRunner({ failFirst: 2 });
    await extractProvinceTiles({ ...input('21', flaky.run), pauseMs: 0 });
    expect(flaky.calls.filter((c) => c.args[0] === 'extract' && !c.args.includes('--dry-run'))).toHaveLength(3);
    const dead = fakeRunner({ failFirst: 9 });
    await expect(extractProvinceTiles({ ...input('22', dead.run), pauseMs: 0 })).rejects.toThrow(/connection reset/);
    expect(dead.calls.filter((c) => c.args[0] === 'extract' && !c.args.includes('--dry-run'))).toHaveLength(3);
    expect(readdirSync(join(dir, 'out')).filter((n) => n.startsWith('22'))).toEqual([]);
  });

  it('tries the size check again when it hangs', async () => {
    const slow = fakeRunner({ dryFailFirst: 2 });
    await extractProvinceTiles({ ...input('23', slow.run), pauseMs: 0 });
    expect(slow.calls.filter((c) => c.args.includes('--dry-run'))).toHaveLength(3);
    const dead = fakeRunner({ dryFailFirst: 9 });
    await expect(extractProvinceTiles({ ...input('24', dead.run), pauseMs: 0 })).rejects.toThrow(/zaman aşımı/);
    expect(dead.calls.filter((c) => c.args.includes('--dry-run'))).toHaveLength(3);
    expect(dead.calls.some((c) => c.args[0] === 'extract' && !c.args.includes('--dry-run'))).toBe(false);
  });

  it('leaves no file behind when verification fails', async () => {
    const { run } = fakeRunner({ verifyCode: 1 });
    await expect(extractProvinceTiles(input('41', run))).rejects.toThrow(/verify/);
    expect(readdirSync(join(dir, 'out')).filter((n) => n.startsWith('41'))).toEqual([]);
  });

  it('skips a finished file but re-fetches after a stale temporary file', async () => {
    const first = fakeRunner();
    await extractProvinceTiles(input('59', first.run));
    const again = fakeRunner();
    await extractProvinceTiles(input('59', again.run));
    expect(again.calls.map((c) => c.args[0])).toEqual(['show']);
    writeFileSync(join(dir, 'out', '16.pmtiles.tmp'), 'half');
    const stale = fakeRunner();
    await extractProvinceTiles(input('16', stale.run));
    expect(stale.calls.map((c) => c.args[0])).toContain('extract');
    expect(existsSync(join(dir, 'out', '16.pmtiles.tmp'))).toBe(false);
  });

  it('rejects a header whose bounds cannot be read', async () => {
    const { run } = fakeRunner({ show: 'tile type: mvt' });
    await expect(extractProvinceTiles(input('10', run))).rejects.toThrow(/bounds/);
  });
});

describe('base pack', () => {
  it('lists the compact font stacks and the light and dark sprites in a fixed order', () => {
    const list = baseAssets();
    const paths = list.map((a) => a.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths.filter((p) => p.startsWith('fonts-compact/NotoSansRegular/')).length).toBe(256);
    expect(paths).toContain('fonts-compact/NotoSansItalic/1536-1791.pbf');
    expect(paths).toContain('sprites/v4/dark@2x.png');
    expect(paths.some((p) => p.startsWith('fonts/'))).toBe(false);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('writes the overview tiles and every asset, and returns the sorted file list', async () => {
    const { run, calls } = fakeRunner();
    const out = mkdtempSync(join(tmpdir(), 'base-'));
    const fetched: string[] = [];
    const files = await buildBasePack({
      build: '20261022', outDir: out, run,
      download: async (url, target) => { fetched.push(url); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, 'x'); },
    });
    expect(files[0]).toBe('fonts-compact/NotoSansItalic/0-255.pbf');
    expect(files).toContain('overview.pmtiles');
    expect(files).toEqual([...files].sort());
    expect(fetched).toHaveLength(baseAssets().length);
    const extract = calls.find((c) => c.args[0] === 'extract' && !c.args.includes('--dry-run'));
    expect(extract?.args).toEqual(expect.arrayContaining(['--bbox=25.5,35.7,45,42.3', '--maxzoom=8']));
  });
});

describe('buildProvinceTiles', () => {
  it('extracts every plate in the given order with its own budget', async () => {
    const { run, calls } = fakeRunner({ dryMb: 50 });
    const dir = mkdtempSync(join(tmpdir(), 'all-'));
    mkdirSync(join(dir, 'regions'));
    for (const plate of ['34', '06', '79']) writeFileSync(join(dir, 'regions', `${plate}.geojson`), '{}');
    const log: string[] = [];
    const result = await buildProvinceTiles({ regionsDir: join(dir, 'regions'), outDir: join(dir, 'tiles'), build: '20261022', plates: ['34', '79', '06'], budgets: { '34': 79, '06': 80 }, run, log: (l) => log.push(l) });
    expect(Object.keys(result)).toEqual(['34', '79', '06']);
    expect(calls.filter((c) => c.args[0] === 'extract' && !c.args.includes('--dry-run')).map((c) => c.args[2])).toEqual([
      join(dir, 'tiles', '34.pmtiles.tmp'), join(dir, 'tiles', '79.pmtiles.tmp'), join(dir, 'tiles', '06.pmtiles.tmp'),
    ]);
    expect(log).toEqual(['34 0.0 MB', '79 0.0 MB', '06 0.0 MB']);
  });

  it('refuses a plate with no region file and a plate over its budget', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'all-'));
    mkdirSync(join(dir, 'regions'));
    writeFileSync(join(dir, 'regions', '35.geojson'), '{}');
    await expect(buildProvinceTiles({ regionsDir: join(dir, 'regions'), outDir: join(dir, 't'), build: 'b', plates: ['99'], budgets: {}, run: fakeRunner().run })).rejects.toThrow(/99/);
    await expect(buildProvinceTiles({ regionsDir: join(dir, 'regions'), outDir: join(dir, 't'), build: 'b', plates: ['35'], budgets: { '35': 10 }, run: fakeRunner({ dryMb: 75 }).run })).rejects.toThrow(/75/);
  });

  it('lists the twelve priority plates', () => {
    expect(PRIORITY_PLATES).toHaveLength(12);
    expect(new Set(PRIORITY_PLATES).size).toBe(12);
  });
});

describe('defaultRunner', () => {
  it('returns the exit code and the output of a command', async () => {
    const result = await defaultRunner(process.execPath, ['-e', 'console.log("merhaba"); process.exit(3)']);
    expect(result.code).toBe(3);
    expect(result.out).toContain('merhaba');
  });

  it('stops a command that runs past the time limit', async () => {
    const started = Date.now();
    const result = await defaultRunner(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], 200);
    expect(result.code).not.toBe(0);
    expect(result.out).toMatch(/zaman aşımı/);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('reports a command that cannot start', async () => {
    const result = await defaultRunner('/yok/komut', []);
    expect(result.code).toBe(127);
  });
});
