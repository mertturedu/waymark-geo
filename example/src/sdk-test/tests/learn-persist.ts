import { File } from 'expo-file-system';
import golden from '../../../../fixtures/address-golden/34.json';
import type { DeviceTest } from '../../device-test/types';
import { ensureIstanbul } from '../sandbox';

const QUERY = (golden as { queries: { text: string }[] }).queries[0]?.text ?? '';
const HINT = { hints: { city: 'İstanbul' } };

export const sdkLearnPersistA: DeviceTest = {
  id: 'sdk.learn-persist-a',
  title: 'Öğrenme 1/2: bir kapıyı pin ile onayla ve kaydet',
  kind: 'auto',
  async run(ctx) {
    const { geo, dir } = await ensureIstanbul(ctx);
    try {
      await geo.learn.clear();
      const found = await geo.search.resolve(QUERY, HINT);
      if (found.status !== 'resolved') return { outcome: 'fail', note: `ilk arama ${found.status}` };
      const point: [number, number] = [found.best.coordinate[0] + 0.0003, found.best.coordinate[1] + 0.0002];
      const result = await geo.learn.confirm({ place: found.best, point, source: 'pin' });
      if (!result.ok || !result.trusted) return { outcome: 'fail', note: `onay sonucu ${JSON.stringify(result)}` };
      const again = await geo.search.resolve(QUERY, HINT);
      if (again.status !== 'resolved' || again.best.source !== 'learned') return { outcome: 'fail', note: 'onaydan sonra öğrenilen nokta dönmedi' };
      const file = new File(dir, 'persist-expect.json');
      if (!file.exists) file.create();
      file.write(JSON.stringify({ point }));
      return { outcome: 'pass', note: 'şimdi uygulamayı tamamen kapat (yukarı kaydırıp at), yeniden aç ve "Öğrenme 2/2" testini çalıştır' };
    } finally {
      await geo.dispose();
    }
  },
};

export const sdkLearnPersistB: DeviceTest = {
  id: 'sdk.learn-persist-b',
  title: 'Öğrenme 2/2: uygulama yeniden açılınca onaylanan nokta duruyor',
  kind: 'auto',
  async run(ctx) {
    const { geo, dir } = await ensureIstanbul(ctx);
    try {
      const file = new File(dir, 'persist-expect.json');
      if (!file.exists) return { outcome: 'skip', note: 'önce Öğrenme 1/2 çalışmalı' };
      const { point } = JSON.parse(await file.text()) as { point: [number, number] };
      const found = await geo.search.resolve(QUERY, HINT);
      if (found.status !== 'resolved') return { outcome: 'fail', note: `arama ${found.status}` };
      const drift = Math.max(Math.abs(found.best.coordinate[0] - point[0]), Math.abs(found.best.coordinate[1] - point[1]));
      if (found.best.source !== 'learned' || drift > 1e-6) return { outcome: 'fail', note: `kaynak ${found.best.source}, sapma ${drift}` };
      return { outcome: 'pass', note: 'öğrenilen nokta yeniden açılışta korundu' };
    } finally {
      await geo.dispose();
    }
  },
};
