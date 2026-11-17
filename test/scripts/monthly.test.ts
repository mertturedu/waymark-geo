import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nominatimStatus, photonStatus, refreshScript } from '../../scripts/monthly';

function setup(pbf: string, ageDays: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'kiyas-'));
  process.env.YUKSI_GEO_KIYAS = dir;
  const script = join(dir, 'nominatim-setup.sh');
  writeFileSync(script, `#!/usr/bin/env bash\nK=x\nPBF=/data/${pbf}\nnominatim import --osm-file "$PBF"\n`);
  const when = new Date(Date.now() - ageDays * 86_400_000);
  utimesSync(script, when, when);
  return dir;
}

afterEach(() => {
  delete process.env.YUKSI_GEO_KIYAS;
});

describe('kıyas motoru tazeliği', () => {
  it('içe aktarılan dosya güncel kaynakla aynıysa ve yeniyse güncel sayar', () => {
    setup('turkey-261028.osm.pbf', 3);
    expect(nominatimStatus('turkey-261028.osm.pbf')).toMatchObject({ ready: true, stale: false, osmFile: 'turkey-261028.osm.pbf' });
  });

  it('dosya değiştiyse ya da 35 günden eskiyse yenilenmeli der', () => {
    setup('turkey-261028.osm.pbf', 3);
    expect(nominatimStatus('turkey-261111.osm.pbf')).toMatchObject({ stale: true, note: expect.stringContaining('güncel kaynak') });
    setup('turkey-261028.osm.pbf', 40);
    expect(nominatimStatus('turkey-261028.osm.pbf')).toMatchObject({ stale: true, ageDays: 40 });
  });

  it('kurulum betiği yoksa hazır değil der', () => {
    process.env.YUKSI_GEO_KIYAS = mkdtempSync(join(tmpdir(), 'kiyas-'));
    expect(nominatimStatus('x.osm.pbf')).toMatchObject({ ready: false, stale: true });
    expect(photonStatus().ready).toBe(false);
  });

  it('yenileme betiği yalnız PBF satırını değiştirir, özgün betiği bırakır', () => {
    const dir = setup('turkey-261028.osm.pbf', 3);
    const out = refreshScript('turkey-261111.osm.pbf', '/data/turkey-261111.osm.pbf') as string;
    expect(readFileSync(out, 'utf8')).toContain('PBF=/data/turkey-261111.osm.pbf');
    expect(readFileSync(out, 'utf8')).toContain('nominatim import');
    expect(readFileSync(join(dir, 'nominatim-setup.sh'), 'utf8')).toContain('PBF=/data/turkey-261028.osm.pbf');
    mkdirSync(join(dir, 'photon'));
    expect(photonStatus()).toMatchObject({ ready: true });
  });
});
