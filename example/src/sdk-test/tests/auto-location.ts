import { createAutoRegion } from '../../../../src/native/logic/auto-region';
import type { GeoNative } from '../../../../src/native';
import type { ConnectionKind } from '../../../../src/core/packs/ports';
import { connectionSwitch } from './connection-switch';
import type { DeviceTest } from '../../device-test/types';
import { openGeo } from '../sandbox';

const BAYBURT: [number, number] = [40.2276, 40.2603];
const IGDIR: [number, number] = [44.0451, 39.9237];
const SEA: [number, number] = [25.0, 36.0];
const SINIR: [number, number] = [29.312, 40.8];
const INSTALL_MS = 240_000;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function installed(geo: GeoNative, id: string, ms: number): Promise<number> {
  const started = Date.now();
  while (geo.regions.status(id).state !== 'installed') {
    if (Date.now() - started > ms) throw new Error(`il ${id} ${ms} ms içinde kurulmadı (durum ${geo.regions.status(id).state})`);
    await pause(250);
  }
  return Date.now() - started;
}

const robot = (geo: GeoNative, connection: ConnectionKind) =>
  createAutoRegion({ suggest: (point) => geo.regions.suggest(point, { connection }), download: (id) => geo.regions.download(id), now: () => Date.now(), retryMs: 60_000 });

export const sdkAutoLocation = test('sdk.auto-location', 'Konuma göre otomatik indirme: bulunduğun il kendiliğinden iner, kurulu il ve deniz için istek yok', async (ctx) => {
  const { geo } = await openGeo(ctx, 'autoloc', { wipe: true, autoDownload: 'always' });
  try {
    const checked = await geo.regions.checkUpdates();
    if (!checked.ok) return { outcome: 'fail', note: `manifest: ${checked.code}` };
    const auto = robot(geo, 'wifi');
    const first = await auto.update(BAYBURT);
    if (first.decision.action !== 'download' || first.started.join() !== '69') return { outcome: 'fail', note: `Bayburt için ${JSON.stringify(first)}` };
    const ms = await installed(geo, '69', INSTALL_MS);
    const second = await auto.update(BAYBURT);
    if (second.started.length > 0 || second.decision.action !== 'none') return { outcome: 'fail', note: `kurulu il için yeniden istek: ${JSON.stringify(second)}` };
    const sea = await auto.update(SEA);
    if (sea.started.length > 0 || sea.decision.action !== 'none') return { outcome: 'fail', note: `denizde karar ${JSON.stringify(sea)}` };
    const elsewhere = geo.regions.suggest(IGDIR, { connection: 'wifi' });
    if (elsewhere.action !== 'download' || elsewhere.regions.join() !== '76') return { outcome: 'fail', note: `Iğdır için ${JSON.stringify(elsewhere)}` };
    const border = geo.regions.suggest(SINIR, { connection: 'wifi' });
    if (border.regions.length !== 1 || border.neighbours.length !== 1) return { outcome: 'fail', note: `il sınırında karar ${JSON.stringify(border)}` };
    const parts = geo.regions.status('69').installedParts.join('+');
    return { outcome: 'pass', value: String(ms), unit: 'ms (Bayburt iniş süresi)', note: `parçalar ${parts}; kurulu ilde, denizde istek yok; Iğdır ve il sınırı kararları doğru (sınırda komşu yalnızca öneri)` };
  } finally {
    await geo.dispose();
  }
});

export const sdkCellularConsent = test('sdk.cellular-consent', 'Mobil veride büyük paket: önce onay, Wi-Fi bekleme Wi-Fi gelince iner, izinle hemen iner', async (ctx) => {
  const link = connectionSwitch('cellular');
  const { geo } = await openGeo(ctx, 'consent', { wipe: true, autoDownload: 'always', cellularAskMb: 1, connectivity: link });
  try {
    const checked = await geo.regions.checkUpdates();
    if (!checked.ok) return { outcome: 'fail', note: `manifest: ${checked.code}` };
    const connection = await geo.regions.connection();
    if (connection !== 'cellular') return { outcome: 'fail', note: `bağlantı ${connection} (cellular beklenir)` };
    const ask = geo.regions.suggest(BAYBURT, { connection });
    if (ask.action !== 'consent' || ask.regions.join() !== '69' || (ask.bytes ?? 0) < 1024 * 1024) return { outcome: 'fail', note: `mobil veride karar ${JSON.stringify(ask)}` };
    const auto = robot(geo, connection);
    const waited = await auto.update(BAYBURT);
    if (waited.started.length > 0 || geo.regions.status('69').state !== 'none') return { outcome: 'fail', note: `onaydan önce indirme başladı: ${JSON.stringify(waited)} durum ${geo.regions.status('69').state}` };
    const queued = geo.regions.download('69', { wifiOnly: true });
    await pause(1500);
    const status = geo.regions.status('69');
    if (!status.waitingWifi || status.state !== 'queued' || status.installedParts.length > 0) return { outcome: 'fail', note: `Wi-Fi bekleme durumu ${JSON.stringify(status)}` };
    const again = geo.regions.suggest(BAYBURT, { connection });
    if (again.action !== 'none') return { outcome: 'fail', note: `kuyrukta bekleyen il için yeniden soru: ${JSON.stringify(again)}` };
    link.set('wifi');
    await queued;
    const ms = await installed(geo, '69', INSTALL_MS);
    const mb = (ask.bytes ?? 0) / (1024 * 1024);
    const direct = await openGeo(ctx, 'consent-allow', { wipe: true, autoDownload: 'always', cellularAskMb: 1, connectivity: connectionSwitch('cellular') });
    try {
      const checkedAgain = await direct.geo.regions.checkUpdates();
      if (!checkedAgain.ok) return { outcome: 'fail', note: `ikinci manifest: ${checkedAgain.code}` };
      await direct.geo.regions.download('76', { allowCellular: true });
      if (direct.geo.regions.status('76').state !== 'installed') return { outcome: 'fail', note: `izinle indirme sonrası durum ${direct.geo.regions.status('76').state}` };
    } finally {
      await direct.geo.dispose();
    }
    return { outcome: 'pass', value: mb.toFixed(1), unit: 'MB sorulan boyut', note: `mobil veride soru (${mb.toFixed(1)} MB), indirme başlamadı; Wi-Fi bekleyen il kuyrukta (soru yok), Wi-Fi gelince ${ms} ms içinde kuruldu; izinle mobil veride indi` };
  } finally {
    await geo.dispose();
  }
});

function test(id: string, title: string, run: DeviceTest['run']): DeviceTest {
  return { id, title, kind: 'auto', run };
}

export const AUTO_LOCATION_TESTS: DeviceTest[] = [sdkAutoLocation, sdkCellularConsent];
