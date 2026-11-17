import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFlags } from '../../scripts/data-release';
import { planPublish } from '../../scripts/data-publish';
import { latestRelease } from '../../scripts/release-lib';

describe('release flags', () => {
  it('defaults to the 12 provinces and promotes the release', () => {
    expect(parseFlags([])).toEqual({ regions: '12il', keepSources: false, allowStale: false, approveRegressions: false, promote: true });
  });

  it('reads every flag', () => {
    expect(parseFlags(['--regions=all', '--pbf', 'a.pbf', '--allow-stale', '--approve-regressions', '--no-promote'])).toEqual({ regions: 'all', pbf: 'a.pbf', keepSources: false, allowStale: true, approveRegressions: true, promote: false });
    expect(parseFlags(['--keep-sources', '--revision', '2'])).toMatchObject({ keepSources: true, revision: 2 });
    expect(parseFlags(['--revision', '1'])).not.toHaveProperty('revision');
    expect(parseFlags(['--revision', 'x'])).not.toHaveProperty('revision');
    expect(parseFlags(['--revision', '2.5'])).not.toHaveProperty('revision');
  });
});

describe('release archive', () => {
  const archive = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'rel-'));
    for (const tag of ['20261020.20261022', '20261029.20261030']) {
      mkdirSync(join(dir, tag, 'packs', '34'), { recursive: true });
      writeFileSync(join(dir, tag, 'packs', 'manifest-v1.json'), '{"regions":[]}');
      writeFileSync(join(dir, tag, 'packs', '34', 'address.sqlite'), 'x'.repeat(10));
      writeFileSync(join(dir, tag, 'summary.json'), JSON.stringify({ tag, osmTimestamp: '', tilesBuild: '', tilesOsmTime: '', regions: {} }));
    }
    return dir;
  };

  it('finds the newest release other than the one being built', () => {
    const dir = archive();
    expect(latestRelease(dir)?.tag).toBe('20261029.20261030');
    expect(latestRelease(dir, '20261029.20261030')?.tag).toBe('20261020.20261022');
    expect(latestRelease(join(dir, 'yok'))).toBeNull();
  });

  it('plans a publish from the newest release or a named one and lists every file', () => {
    const dir = archive();
    expect(planPublish(dir)).toMatchObject({ tag: '20261029.20261030', total: 24 });
    expect(planPublish(dir, '20261020.20261022')?.files.map((f) => f.path)).toEqual(['34/address.sqlite', 'manifest-v1.json']);
    expect(planPublish(dir, 'yok')).toBeNull();
  });
});
