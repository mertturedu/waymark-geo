import { compareReleases, freshnessProblems, renderChangeReport, tagOf, type ReleaseSummary, type RegionSummary } from '../../scripts/release-lib';
import type { Sources } from '../../scripts/fetch-sources';

const region = (patch: Partial<RegionSummary> = {}): RegionSummary => ({ addresses: 1000, streets: 200, neighbourhoods: 20, places: 500, routeNodes: 10_000, tilesBytes: 1_000_000, hoods: ['a', 'b', 'c'], ...patch });
const release = (tag: string, regions: Record<string, RegionSummary>): ReleaseSummary => ({ tag, osmTimestamp: '2026-10-20T20:00:00Z', tilesBuild: '20261022', tilesOsmTime: '2026-10-22T04:00:00Z', regions });
const sources = (patch: Partial<Sources> = {}): Sources => ({ osmFile: 'turkey-261029.osm.pbf', osmMd5: 'x', osmTimestamp: '2026-10-29T20:00:00Z', tilesBuild: '20261030', tilesOsmTime: '2026-10-30T04:00:00Z', ...patch });

describe('freshness', () => {
  it('accepts sources under 7 days old and at most 3 days apart', () => {
    expect(freshnessProblems(sources(), new Date('2026-10-30T12:00:00Z'))).toEqual([]);
  });

  it('names each stale or distant source', () => {
    const stale = freshnessProblems(sources({ osmTimestamp: '2026-10-20T20:00:00Z' }), new Date('2026-10-30T12:00:00Z'));
    expect(stale.join('|')).toMatch(/OSM verisi 9\.\d günlük/);
    expect(stale.join('|')).toMatch(/OSM ile karo arası 9\.\d gün/);
    expect(freshnessProblems(sources({ tilesOsmTime: '2026-10-22T04:00:00Z' }), new Date('2026-10-30T12:00:00Z')).join('|')).toMatch(/karo verisi/);
    expect(freshnessProblems(sources({ osmTimestamp: 'bozuk' }), new Date())).toEqual(['kaynak tarihleri okunamadı']);
  });

  it('builds the release tag from both dates', () => {
    expect(tagOf(sources())).toBe('20261029.20261030');
  });
});

describe('release comparison', () => {
  const before = release('a', { '34': region(), '06': region() });

  it('lets small drops pass and counts new and gone neighbourhoods', () => {
    const after = release('b', { '34': region({ addresses: 990, streets: 198, routeNodes: 9800, hoods: ['a', 'b', 'd'] }), '06': region({ addresses: 1500 }) });
    const result = compareReleases(before, after);
    expect(result.violations).toEqual([]);
    expect(result.rows.find((r) => r.plate === '34')).toMatchObject({ addresses: -10, newHoods: ['d'], goneHoods: ['c'] });
    expect(result.rows.find((r) => r.plate === '06')).toMatchObject({ addresses: 500 });
  });

  it('flags drops and tile swings beyond the limits and nothing at the limits', () => {
    const edge = compareReleases(before, release('b', { '34': region({ addresses: 980, streets: 196, routeNodes: 9700, tilesBytes: 1_250_000 }), '06': region() }));
    expect(edge.violations).toEqual([]);
    const worse = compareReleases(before, release('b', { '34': region({ addresses: 979, streets: 195, routeNodes: 9699, tilesBytes: 1_250_001 }), '06': region({ tilesBytes: 700_000 }) }));
    expect(worse.violations.map((v) => `${v.plate}:${v.metric}`).sort()).toEqual(['06:tilesBytes', '34:addresses', '34:routeNodes', '34:streets', '34:tilesBytes']);
  });

  it('reports regions that appear or vanish', () => {
    const result = compareReleases(before, release('b', { '34': region(), '35': region() }));
    expect(result.addedRegions).toEqual(['35']);
    expect(result.removedRegions).toEqual(['06']);
  });

  it('writes a readable change report with the gate verdict', () => {
    const after = release('b', { '34': region({ addresses: 900 }), '06': region() });
    const text = renderChangeReport(before, after, compareReleases(before, after));
    expect(text).toContain('| 34 | -100 |');
    expect(text).toContain('Gerileme kapısı (K8.2): GEÇMEDİ');
    expect(text).toContain('- 34 addresses: 1000 → 900');
  });
});
