import { LocationManager } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { distanceM } from '../../../../src/core/geo/distance';
import type { DeviceTest } from '../../device-test/types';
import { DENIZLI, KADIKOY, test, withTour, type Tour } from './map-tour';
import type { LngLat } from '../map-tour/driver';

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(read: () => Promise<T> | T, done: (value: T) => boolean, ms: number, what: string): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() - started > ms) throw new Error(`zaman aşımı: ${what} (${ms} ms)`);
    await pause(200);
  }
}

async function probe(): Promise<string> {
  let count = 0;
  let age = -1;
  const listener = (position: { timestamp: number }) => {
    count += 1;
    age = Math.round((Date.now() - position.timestamp) / 1000);
  };
  const cached = await LocationManager.getCurrentPosition();
  LocationManager.addListener(listener);
  await pause(6000);
  LocationManager.removeListener(listener);
  return `önbellek ${cached ? 'var' : 'yok'}, 6 sn'de ${count} güncelleme, son yaş ${age} sn`;
}

const modeIs = (tour: Tour, mode: string) => until(() => tour.locateState().mode, (now) => now === mode, 8000, `konum modu ${mode} (şimdi ${JSON.stringify(tour.locateState())}; olaylar ${tour.events().filter((event) => event.startsWith('locate')).join(',') || '-'})`);

export const sdkLocateCycle = test('sdk.locate-cycle', 'Konum düğmesi: kapalı → takip → yöne göre → takip, yakınlaşır, eğim korunur, durdurunca kamera serbest kalır', (ctx) =>
  withTour(ctx, async (tour) => {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') return { outcome: 'skip', note: 'konum izni verilmemiş (telefonda uygulamada bir kez izin verin; simülatörde device-run --location ile)' };
    const fix = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    const me: LngLat = [fix.coords.longitude, fix.coords.latitude];
    const start: LngLat = distanceM(me, KADIKOY) < 30_000 ? DENIZLI : KADIKOY;
    tour.say('Konum düğmesi');
    await tour.go({ center: start, zoom: 12, pitch: 20 }, 'jump');
    const before = tour.locateState();
    if (before.mode !== 'off' || before.permission !== 'granted') return { outcome: 'fail', note: `başlangıç durumu ${JSON.stringify(before)}` };

    await tour.locatePress();
    await modeIs(tour, 'follow').catch(async (error: Error) => {
      throw new Error(`${error.message} | doğrudan okuma: ${await probe()}`);
    });
    const near = await until(() => tour.view(), (view) => distanceM(view.center, me) < 400 && view.zoom >= 15.9 && Math.abs((view.pitch ?? 0) - 20) <= 2, 20000, 'kamera konuma yaklaşmadı');
    const metres = Math.round(distanceM(near.center, me));

    await tour.locatePress();
    await modeIs(tour, 'heading');
    await tour.locatePress();
    await modeIs(tour, 'follow');

    tour.locateStop();
    await modeIs(tour, 'off');
    await tour.go({ center: start, zoom: 12, pitch: 20 }, 'jump');
    await pause(2500);
    const away = await tour.view();
    const back = Math.round(distanceM(away.center, me));
    if (back < 5000) return { outcome: 'fail', note: `takip kapandı ama kamera konuma geri döndü (${back} m)` };
    return { outcome: 'pass', value: String(metres), unit: 'm (kamera ile konum arası)', note: `takip, yöne göre, takip, durdurunca kamera serbest kaldı (konumdan ${back} m uzakta kaldı); zoom ${near.zoom.toFixed(2)}, eğim ${(near.pitch ?? 0).toFixed(1)}` };
  }),
);

export const LOCATE_TESTS: DeviceTest[] = [sdkLocateCycle];
