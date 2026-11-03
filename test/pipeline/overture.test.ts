import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOverturePlaces, overtureRelease } from '../../pipeline/build/overture';
import { annotateFile, annotateLine } from '../../pipeline/build/places-annotate';
import { glyphOf } from '../../src/native/map/poi-glyphs';

const glyphOfCafe = (): string | null => glyphOf('cafe', 'food');

type Call = { cmd: string; args: string[] };

function rig(summary: Record<string, { all: number; kept: number; minzoom: number | null }>) {
  const work = mkdtempSync(join(tmpdir(), 'ov-'));
  const calls: Call[] = [];
  const run = async (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    if (cmd === '/py') {
      const out = args[args.indexOf('--out') + 1] as string;
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'summary.json'), JSON.stringify({ release: 'r1', plates: summary }));
      for (const plate of Object.keys(summary)) writeFileSync(join(out, `${plate}.geojsonl`), '{}\n');
      return { code: 0, out: '{}' };
    }
    const script = args[args.length - 1] as string;
    const target = /-o '?([^ ']+)'?/.exec(script)?.[1] as string;
    writeFileSync(join(work, 'overture', target), `tiles:${script}`);
    return { code: 0, out: '' };
  };
  return { work, calls, run };
}

describe('overtureRelease', () => {
  it('reads the pinned release from the config file', () => {
    expect(overtureRelease()).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

describe('buildOverturePlaces', () => {
  it('extracts for the asked provinces and builds one overlay file for each province that has places', async () => {
    const { work, calls, run } = rig({ '20': { all: 10, kept: 8, minzoom: 14 }, '34': { all: 90, kept: 70, minzoom: 13 }, '58': { all: 0, kept: 0, minzoom: null } });
    const result = await buildOverturePlaces({ release: 'r1', plates: ['20', '34', '58'], workDir: work, cacheDir: join(work, 'cache'), python: '/py', script: '/s/overture_places.py', borders: join(work, 'borders.jsonl'), run });
    const extract = calls[0] as Call;
    expect(extract.cmd).toBe('/py');
    expect(extract.args).toEqual(['/s/overture_places.py', '--release', 'r1', '--borders', join(work, 'borders.jsonl'), '--out', join(work, 'overture'), '--cache', join(work, 'cache'), '--plates', '20,34,58']);
    expect(Object.keys(result.files).sort()).toEqual(['20', '34']);
    expect(result.files['20']).toBe(join(work, 'overture', '20.pmtiles'));
    expect(readFileSync(result.files['34'] as string, 'utf8')).toContain('-Z13');
    expect(readFileSync(result.files['20'] as string, 'utf8')).toContain('-Z14');
    expect(result.kept).toEqual({ '20': 8, '34': 70, '58': 0 });
  });

  it('runs the tile maker inside the overlay folder with relative names so the bytes do not depend on where the work folder is', async () => {
    const { work, calls, run } = rig({ '20': { all: 1, kept: 1, minzoom: 15 } });
    await buildOverturePlaces({ release: 'r1', plates: ['20'], workDir: work, cacheDir: join(work, 'cache'), python: '/py', script: '/s/x.py', borders: 'b', run });
    const tiles = calls[1] as Call;
    expect(tiles.cmd).toBe('/bin/sh');
    expect(tiles.args[0]).toBe('-c');
    const script = tiles.args[1] as string;
    expect(script.startsWith(`cd '${join(work, 'overture')}' && tippecanoe `)).toBe(true);
    expect(script).toContain("-o '20.build.pmtiles'");
    expect(script).toContain("'20.annotated.geojsonl'");
    expect(script).not.toContain(work.replace(/'/g, '') + '/20');
  });

  it('asks for all provinces with the word all', async () => {
    const { work, calls, run } = rig({ '20': { all: 1, kept: 1, minzoom: 15 } });
    await buildOverturePlaces({ release: 'r1', plates: Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0')), workDir: work, cacheDir: 'c', python: '/py', script: '/s/x.py', borders: 'b', run });
    expect((calls[0] as Call).args.at(-1)).toBe('all');
  });

  it('stops with the tail of the output when the extractor fails', async () => {
    const work = mkdtempSync(join(tmpdir(), 'ov-'));
    const run = async () => ({ code: 1, out: 'duckdb: boom '.repeat(100) });
    await expect(buildOverturePlaces({ release: 'r1', plates: ['20'], workDir: work, cacheDir: 'c', python: '/py', script: '/s/x.py', borders: 'b', run })).rejects.toThrow(/overture_places\.py: .*boom/);
  });

  it('stops when the tile maker fails and names the province', async () => {
    const { work, run: inner } = rig({ '20': { all: 1, kept: 1, minzoom: 15 } });
    const run = async (cmd: string, args: string[]) => (cmd === '/bin/sh' ? { code: 2, out: 'tippecanoe: bad input' } : inner(cmd, args));
    await expect(buildOverturePlaces({ release: 'r1', plates: ['20'], workDir: work, cacheDir: 'c', python: '/py', script: '/s/x.py', borders: 'b', run })).rejects.toThrow(/20: tippecanoe: bad input/);
  });

  it('tries the tile maker once more after a failure and succeeds when the second run works', async () => {
    const { work, run: inner } = rig({ '20': { all: 1, kept: 1, minzoom: 15 } });
    let tries = 0;
    const run = async (cmd: string, args: string[]) => (cmd === '/bin/sh' && ++tries === 1 ? { code: 1, out: 'Corrupt mbtiles file' } : inner(cmd, args));
    const result = await buildOverturePlaces({ release: 'r1', plates: ['20'], workDir: work, cacheDir: 'c', python: '/py', script: '/s/x.py', borders: 'b', run });
    expect(tries).toBe(2);
    expect(Object.keys(result.files)).toEqual(['20']);
  });

  it('removes a half written file when the tile maker fails', async () => {
    const { work, run: inner } = rig({ '20': { all: 1, kept: 1, minzoom: 15 } });
    const run = async (cmd: string, args: string[]) => {
      if (cmd === '/bin/sh') {
        writeFileSync(join(work, 'overture', '20.build.pmtiles'), 'half');
        return { code: 1, out: 'x' };
      }
      return inner(cmd, args);
    };
    await expect(buildOverturePlaces({ release: 'r1', plates: ['20'], workDir: work, cacheDir: 'c', python: '/py', script: '/s/x.py', borders: 'b', run })).rejects.toBeDefined();
    expect(() => readFileSync(join(work, 'overture', '20.build.pmtiles'))).toThrow();
  });
});

describe('place annotation', () => {
  const line = (properties: object | undefined) => JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [29, 41] }, ...(properties ? { properties } : {}) });

  it('adds the glyph, tier and group to every place and keeps what was there', () => {
    const out = JSON.parse(annotateLine(line({ c: 90, cat: 'pharmacy', g: 'pharmacy', name: 'Merkez Eczanesi', b: 'x' }))) as { properties: Record<string, unknown>; geometry: unknown };
    expect(out.properties).toEqual({ c: 90, g: 'pharmacy', name: 'Merkez Eczanesi', b: 'x', k: 'pharmacy', t: 2, grp: 'pharmacy' });
    expect(out.geometry).toEqual({ type: 'Point', coordinates: [29, 41] });
  });

  it('takes the category out of the tile because the glyph already carries it', () => {
    expect(JSON.parse(annotateLine(line({ cat: 'cafe', g: 'food', name: 'Moda' }))).properties).not.toHaveProperty('cat');
  });

  it('gives a place whose name ends in camii the mosque glyph even when the category is wrong', () => {
    expect(JSON.parse(annotateLine(line({ cat: 'retirement_home', g: 'other', name: 'Hacı Şam Camii' }))).properties).toMatchObject({ k: 'mosque', t: 2, grp: 'worship' });
  });

  it('marks a place without a glyph and survives a feature with no properties', () => {
    expect(JSON.parse(annotateLine(line({ cat: 'real_estate_agent', g: 'other' }))).properties).toEqual({ g: 'other', k: 'none', t: 0, grp: 'public' });
    expect(JSON.parse(annotateLine('{}')).properties).toEqual({ k: 'none', t: 0, grp: 'public' });
    expect(annotateLine('   ')).toBe('   ');
  });

  it('rewrites a whole file one place per line and skips blank lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ann-'));
    const input = join(dir, 'in.geojsonl');
    writeFileSync(input, `${line({ cat: 'hospital', g: 'health' })}

${line({ cat: 'cafe', g: 'food' })}
`);
    expect(await annotateFile(input, join(dir, 'out.geojsonl'))).toBe(2);
    const rows = readFileSync(join(dir, 'out.geojsonl'), 'utf8').trim().split('\n').map((row) => JSON.parse(row).properties);
    expect(rows.map((r: { k: string }) => r.k)).toEqual(['hospital', glyphOfCafe()]);
  });

  it('removes the half written file and passes the error on when a line is broken', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ann-'));
    const input = join(dir, 'in.geojsonl');
    writeFileSync(input, `${line({ cat: 'hospital', g: 'health' })}\nnot json\n`);
    await expect(annotateFile(input, join(dir, 'out.geojsonl'))).rejects.toThrow();
    expect(existsSync(join(dir, 'out.geojsonl'))).toBe(false);
  });

  it('leaves no annotated copy behind after the tiles are built', async () => {
    const { work, run } = rig({ '20': { all: 1, kept: 1, minzoom: 15 } });
    await buildOverturePlaces({ release: 'r1', plates: ['20'], workDir: work, cacheDir: 'c', python: '/py', script: '/s/x.py', borders: 'b', run });
    expect(existsSync(join(work, 'overture', '20.annotated.geojsonl'))).toBe(false);
  });
});
