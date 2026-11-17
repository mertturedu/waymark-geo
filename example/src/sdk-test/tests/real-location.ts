import * as Location from 'expo-location';
import { detectRegion } from '../../../../src/core/packs/region';
import { embeddedBorders } from '../../../../src/core/region/embedded';
import type { DeviceTest } from '../../device-test/types';
import { regionProbe } from '../../sdk/region-probe';

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const WAIT_MS = 300_000;

export const sdkRealLocationDownload: DeviceTest = {
  id: 'sdk.real-location-download',
  title: 'Gerçek konum: uygulama sekmesi açıkken bulunulan ilin paketi kendiliğinden iner',
  kind: 'auto',
  async run() {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') return { outcome: 'skip', note: 'konum izni verilmemiş' };
    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const me: [number, number] = [fix.coords.longitude, fix.coords.latitude];
    const wanted = detectRegion(embeddedBorders(), me).region;
    if (!wanted) return { outcome: 'skip', note: `konum (${me[1].toFixed(3)}, ${me[0].toFixed(3)}) hiçbir ilde değil` };
    const mounting = Date.now();
    while (!regionProbe() && Date.now() - mounting < 30_000) await pause(250);
    const first = regionProbe();
    if (!first) return { outcome: 'fail', note: 'uygulama sekmesi kurulu değil (device-run --app ile çalıştırın)' };
    if (first.installed.includes(wanted)) return { outcome: 'skip', note: `il ${wanted} zaten kuruluydu (temiz kurulumla deneyin)` };
    const started = Date.now();
    for (;;) {
      const probe = regionProbe();
      if (probe?.installed.includes(wanted)) {
        const seconds = Math.round((Date.now() - started) / 1000);
        return { outcome: 'pass', value: String(seconds), unit: 'sn', note: `konum (${me[1].toFixed(3)}, ${me[0].toFixed(3)}), il ${wanted} kendiliğinden kuruldu; kurulu iller ${probe.installed.join('+')}` };
      }
      if (Date.now() - started > WAIT_MS) return { outcome: 'fail', note: `il ${wanted} ${WAIT_MS / 1000} sn içinde kurulmadı; son karar ${probe?.action ?? 'yok'}, konum ${probe?.location ? 'okundu' : 'okunamadı'}, bekleyen ${probe?.waiting.join('+') || '-'}` };
      await pause(500);
    }
  },
};

export const sdkRealLocationForget: DeviceTest = {
  id: 'sdk.real-location-forget',
  title: 'Gerçek konum hazırlığı: bulunulan ilin paketini uygulama sekmesinden siler',
  kind: 'auto',
  async run() {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') return { outcome: 'skip', note: 'konum izni verilmemiş' };
    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const wanted = detectRegion(embeddedBorders(), [fix.coords.longitude, fix.coords.latitude]).region;
    if (!wanted) return { outcome: 'skip', note: 'konum hiçbir ilde değil' };
    const mounting = Date.now();
    while (!regionProbe() && Date.now() - mounting < 30_000) await pause(250);
    const probe = regionProbe();
    if (!probe) return { outcome: 'fail', note: 'uygulama sekmesi kurulu değil (device-run --app ile çalıştırın)' };
    if (!probe.installed.includes(wanted)) return { outcome: 'pass', note: `il ${wanted} zaten kurulu değildi` };
    await probe.remove(wanted);
    return { outcome: 'pass', note: `il ${wanted} silindi; uygulamayı yeniden açıp sdk.real-location-download çalıştırın` };
  },
};

export const REAL_LOCATION_TESTS: DeviceTest[] = [sdkRealLocationForget, sdkRealLocationDownload];
