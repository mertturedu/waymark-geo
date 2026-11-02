import type { DeviceTest } from '../../device-test/types';
import { ensureIstanbul } from '../sandbox';
import { firstDoor, HINT, metres } from './helpers';

const test = (id: string, title: string, run: DeviceTest['run']): DeviceTest => ({ id, title, kind: 'auto', run });

export const sdkLearnExport = test('sdk.learn-export', 'Öğrenme: dışa aktar, sil, içe aktar, nokta geri gelir', async (ctx) => {
  const { geo } = await ensureIstanbul(ctx);
  try {
    await geo.learn.clear();
    const door = await firstDoor(geo);
    if (!door) return { outcome: 'fail', note: 'çözülen kapı bulunamadı' };
    const point: [number, number] = [door.place.coordinate[0] + 0.0003, door.place.coordinate[1] + 0.0002];
    const confirmed = await geo.learn.confirm({ place: door.place, point, source: 'pin' });
    if (!confirmed.ok) return { outcome: 'fail', note: `onay ${JSON.stringify(confirmed)}` };
    const lines = geo.learn.export();
    if (lines.length !== 1) return { outcome: 'fail', note: `dışa aktarılan satır ${lines.length}` };
    await geo.learn.clear();
    if (geo.learn.stats().keys !== 0) return { outcome: 'fail', note: 'silinince kayıt kaldı' };
    const imported = await geo.learn.import(lines);
    if (imported.added !== 1) return { outcome: 'fail', note: `içe aktarma ${JSON.stringify(imported)}` };
    const again = await geo.search.resolve(door.text, HINT);
    if (again.status !== 'resolved' || again.best.source !== 'learned' || metres(again.best.coordinate, point) > 1) return { outcome: 'fail', note: 'içe aktarılan nokta aramada dönmedi' };
    return { outcome: 'pass' };
  } finally {
    await geo.learn.clear();
    await geo.dispose();
  }
});

export const sdkLearnOutlier = test('sdk.learn-outlier', 'Öğrenme: uzak tek teslimat güvenilir pini bozmaz', async (ctx) => {
  const { geo } = await ensureIstanbul(ctx);
  try {
    await geo.learn.clear();
    const door = await firstDoor(geo);
    if (!door) return { outcome: 'fail', note: 'çözülen kapı bulunamadı' };
    const pin: [number, number] = [door.place.coordinate[0] + 0.0003, door.place.coordinate[1] + 0.0002];
    const far: [number, number] = [pin[0], pin[1] + 0.0015];
    await geo.learn.confirm({ place: door.place, point: pin, source: 'pin' });
    const second = await geo.learn.confirm({ place: door.place, point: far, source: 'delivery' });
    if (!second.ok) return { outcome: 'fail', note: `ikinci onay ${JSON.stringify(second)}` };
    const found = await geo.search.resolve(door.text, HINT);
    if (found.status !== 'resolved' || metres(found.best.coordinate, pin) > 1) return { outcome: 'fail', note: 'aykırı teslimat pin noktasını kaydırdı' };
    if (geo.learn.stats().confirmations !== 2) return { outcome: 'fail', note: `kayıtlı onay ${geo.learn.stats().confirmations}` };
    return { outcome: 'pass', note: 'iki onay saklandı, nokta pinde kaldı' };
  } finally {
    await geo.learn.clear();
    await geo.dispose();
  }
});

export const sdkLearnDelivery = test('sdk.learn-delivery', 'Öğrenme: tek teslimat güvenilmez, OSM kapısının yerine geçmez', async (ctx) => {
  const { geo } = await ensureIstanbul(ctx);
  try {
    await geo.learn.clear();
    const door = await firstDoor(geo);
    if (!door) return { outcome: 'fail', note: 'çözülen kapı bulunamadı' };
    const point: [number, number] = [door.place.coordinate[0] + 0.0003, door.place.coordinate[1] + 0.0002];
    const result = await geo.learn.confirm({ place: door.place, point, source: 'delivery' });
    if (!result.ok || result.trusted) return { outcome: 'fail', note: `tek teslimat sonucu ${JSON.stringify(result)}` };
    const found = await geo.search.resolve(door.text, HINT);
    if (found.status !== 'resolved' || found.best.source === 'learned') return { outcome: 'fail', note: 'güvenilmeyen nokta gerçek OSM noktasının yerine geçti' };
    return { outcome: 'pass', note: `kaynak ${found.best.source}` };
  } finally {
    await geo.learn.clear();
    await geo.dispose();
  }
});

export const LEARN_TESTS: DeviceTest[] = [sdkLearnExport, sdkLearnOutlier, sdkLearnDelivery];
