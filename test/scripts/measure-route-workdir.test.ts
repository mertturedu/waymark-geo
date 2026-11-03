import { FALLBACK_WORK, workDateOf } from '../../scripts/measure-route';

describe('route measurement data folder', () => {
  it('follows the OSM date of the published packs', () => {
    expect(workDateOf(JSON.stringify({ osm: { file: 'turkey-261028.osm.pbf', time: '2026-10-28T21:21:02Z' } }))).toBe('261028');
  });

  it('falls back to the first data date when the manifest says nothing usable', () => {
    expect(workDateOf(null)).toBe(FALLBACK_WORK);
    expect(workDateOf('{')).toBe(FALLBACK_WORK);
    expect(workDateOf('{}')).toBe(FALLBACK_WORK);
    expect(workDateOf(JSON.stringify({ osm: { file: 'europe.osm.pbf' } }))).toBe(FALLBACK_WORK);
  });
});
