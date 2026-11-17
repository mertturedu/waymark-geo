import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gapDays, parseGeofabrikName, renderSources, verifyMd5, type Sources } from '../../scripts/fetch-sources';

const sources: Sources = {
  osmFile: 'turkey-261020.osm.pbf',
  osmMd5: 'a'.repeat(32),
  osmTimestamp: '2026-10-20T20:23:47Z',
  tilesBuild: '20261022',
  tilesOsmTime: '2026-10-22T04:00:00Z',
};

describe('parseGeofabrikName', () => {
  it('reads the date from a dated file name', () => {
    expect(parseGeofabrikName('turkey-261020.osm.pbf')).toEqual({ date: '2026-10-20' });
    expect(parseGeofabrikName('turkey-270105.osm.pbf')).toEqual({ date: '2027-01-05' });
  });

  it.each(['turkey-latest.osm.pbf', 'turkey-261020.osm.pbf.md5', 'turkey-261320.osm.pbf', 'turkey-261032.osm.pbf', 'iran-261020.osm.pbf', ''])(
    'rejects %j',
    (name) => {
      expect(parseGeofabrikName(name)).toBeNull();
    },
  );
});

describe('verifyMd5', () => {
  const dir = mkdtempSync(join(tmpdir(), 'md5-'));
  const file = join(dir, 'blob.bin');
  writeFileSync(file, 'Mert Turedu1');
  const real = createHash('md5').update('Mert Turedu1').digest('hex');

  it('accepts the right digest in any letter case', async () => {
    expect(await verifyMd5(file, real)).toBe(true);
    expect(await verifyMd5(file, real.toUpperCase())).toBe(true);
  });

  it('rejects another digest', async () => {
    expect(await verifyMd5(file, 'f'.repeat(32))).toBe(false);
  });

  it('throws when the file is missing', async () => {
    await expect(verifyMd5(join(dir, 'yok.bin'), real)).rejects.toThrow();
  });
});

describe('gapDays', () => {
  it('measures the distance between two times in days with one decimal', () => {
    expect(gapDays('2026-10-20T20:23:47Z', '2026-10-22T04:00:00Z')).toBe(1.3);
    expect(gapDays('2026-10-22T04:00:00Z', '2026-10-20T20:23:47Z')).toBe(1.3);
    expect(gapDays('2026-10-22T04:00:00Z', '2026-10-22T04:00:00Z')).toBe(0);
  });
});

describe('renderSources', () => {
  it('writes keys in a fixed order with a closing newline', () => {
    const text = renderSources(sources);
    expect(text.endsWith('\n')).toBe(true);
    expect(Object.keys(JSON.parse(text))).toEqual(['osmFile', 'osmMd5', 'osmTimestamp', 'tilesBuild', 'tilesOsmTime']);
  });

  it('gives the same text whatever the key order of the input', () => {
    const shuffled = { tilesOsmTime: sources.tilesOsmTime, osmFile: sources.osmFile, tilesBuild: sources.tilesBuild, osmTimestamp: sources.osmTimestamp, osmMd5: sources.osmMd5 };
    expect(renderSources(shuffled)).toBe(renderSources(sources));
    expect(JSON.parse(renderSources(sources))).toEqual(sources);
  });
});
