import type { DeviceTest } from '../../device-test/types';
import { buildStyle } from '../../../../src/native';
import { ensureIstanbul, openGeo } from '../sandbox';

const test = (id: string, title: string, run: DeviceTest['run']): DeviceTest => ({ id, title, kind: 'auto', run });

export const sdkRegionsList = test('sdk.regions-list', 'Bölgeler: 81 il listesi, her ilde adres ve rota paketi', async (ctx) => {
  const { geo } = await ensureIstanbul(ctx);
  try {
    const checked = await geo.regions.checkUpdates();
    if (!checked.ok) return { outcome: 'fail', note: `manifest: ${checked.code}` };
    const regions = geo.regions.list();
    if (regions.length !== 81) return { outcome: 'fail', note: `${regions.length} il, beklenen 81` };
    if (new Set(regions.map((r) => r.id)).size !== 81) return { outcome: 'fail', note: 'il numaraları tekrar ediyor' };
    const lacking = regions.filter((r) => !r.files.some((f) => f.kind === 'address') || !r.files.some((f) => f.kind === 'route')).map((r) => r.id);
    if (lacking.length > 0) return { outcome: 'fail', note: `adres ya da rota paketi eksik: ${lacking.join(', ')}` };
    const route = regions.reduce((sum, r) => sum + (r.files.find((f) => f.kind === 'route')?.size ?? 0), 0);
    return { outcome: 'pass', note: `81 il, rota paketleri toplam ${(route / 1e6).toFixed(0)} MB` };
  } finally {
    await geo.dispose();
  }
});

export const sdkRemovePart = test('sdk.remove-part', 'Bölgeler: yalnızca rota parçası silinir, adres kalır', async (ctx) => {
  const { geo } = await openGeo(ctx, 'parts', { wipe: true });
  try {
    const checked = await geo.regions.checkUpdates();
    if (!checked.ok) return { outcome: 'fail', note: `manifest: ${checked.code}` };
    await geo.regions.download('41', { parts: ['address', 'route'] });
    const both = geo.regions.status('41').installedParts;
    if (!both.includes('address') || !both.includes('route')) return { outcome: 'fail', note: `kurulan parçalar ${both.join(', ')}` };
    if (!(await geo.route.installed()).includes('41')) return { outcome: 'fail', note: 'rota kurulu listesinde yok' };
    await geo.regions.remove('41', ['route']);
    const after = geo.regions.status('41');
    if (after.installedParts.includes('route') || !after.installedParts.includes('address')) return { outcome: 'fail', note: `silmeden sonra parçalar ${after.installedParts.join(', ')}` };
    if ((await geo.route.installed()).includes('41')) return { outcome: 'fail', note: 'rota silindi ama listede duruyor' };
    await geo.regions.remove('41');
    if (geo.regions.status('41').state !== 'none') return { outcome: 'fail', note: `tam silmeden sonra durum ${geo.regions.status('41').state}` };
    return { outcome: 'pass' };
  } finally {
    await geo.dispose();
  }
});

export const sdkMapStyle = test('sdk.map-style', 'Harita stili: açık ve koyu tema, dil değişimi', async (ctx) => {
  const { geo } = await ensureIstanbul(ctx);
  try {
    const light = geo.map.style({ theme: 'light' });
    const dark = geo.map.style({ theme: 'dark' });
    const text = (style: unknown): string => JSON.stringify(style);
    if (text(light) === text(dark)) return { outcome: 'fail', note: 'koyu stil açıkla aynı' };
    const sample = (theme: 'light' | 'dark', lang: string) =>
      buildStyle({ rootUrl: 'file:///stil/', baseDir: 'base', regions: [{ id: '34', tilesPath: '34/tiles.pmtiles', placesPath: '34/places.pmtiles' }], theme, lang });
    const full = sample('light', 'tr');
    if (text(full).length < 1000) return { outcome: 'fail', note: 'stil çok kısa' };
    if (text(full) === text(sample('dark', 'tr'))) return { outcome: 'fail', note: 'bölgeli koyu stil açıkla aynı' };
    if (text(full) === text(sample('light', 'en'))) return { outcome: 'fail', note: 'dil değişince stil değişmedi' };
    const layers = full.layers.length;
    if (layers < 5) return { outcome: 'fail', note: `stilde ${layers} katman` };
    return { outcome: 'pass', note: `${layers} katman, ${(text(full).length / 1024).toFixed(0)} KB` };
  } finally {
    await geo.dispose();
  }
});

export const REGION_TESTS: DeviceTest[] = [sdkRegionsList, sdkRemovePart, sdkMapStyle];
