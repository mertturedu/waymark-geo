import { File, FileMode } from 'expo-file-system';
import * as Network from 'expo-network';
import { mapEventNames } from '../../spikes/mapEvents';
import type { DeviceTest } from '../types';

const MAP_FILE = 'istanbul-kadikoy.pmtiles';

export const d1PmtilesFile: DeviceTest = {
  id: 'd1.pmtiles-file',
  title: 'Yerel PMTiles dosyası var ve geçerli başlıkta',
  kind: 'auto',
  async run(ctx) {
    const file = new File(`${ctx.packsDir.replace(/\/$/, '')}/${MAP_FILE}`);
    if (!file.exists) return { outcome: 'fail', note: `${MAP_FILE} yok, önce paketleri indir` };
    const handle = file.open(FileMode.ReadOnly);
    const head = new TextDecoder().decode(handle.readBytes(7));
    handle.close();
    if (head !== 'PMTiles') return { outcome: 'fail', note: `başlık "${head}"` };
    return { outcome: 'pass', value: String(file.size), unit: 'bayt' };
  },
};

export const d1NetState: DeviceTest = {
  id: 'd1.net-state',
  title: 'Ağ kapalı (uçak modu, Wi-Fi kapalı)',
  kind: 'auto',
  async run() {
    const state = await Network.getNetworkStateAsync();
    const detail = `bağlı ${String(state.isConnected)}, internet ${String(state.isInternetReachable)}, tür ${String(state.type)}`;
    return state.isConnected ? { outcome: 'fail', note: `ağ açık: ${detail}` } : { outcome: 'pass', note: detail };
  },
};

export const d1MapEvents: DeviceTest = {
  id: 'd1.map-events',
  title: 'Harita ekranı stili yükledi (yükleme olayları)',
  kind: 'auto',
  async run() {
    const events = mapEventNames();
    if (events.length === 0) return { outcome: 'fail', note: 'harita ekranı açılmadı, önce Harita sekmesini aç' };
    if (events.includes('didFailLoadingMap')) return { outcome: 'fail', note: `yükleme başarısız: ${events.join(' > ')}` };
    return events.includes('didFinishLoadingMap') ? { outcome: 'pass', note: events.join(' > ') } : { outcome: 'fail', note: `stil yüklenmedi: ${events.join(' > ')}` };
  },
};

export const d1MapOffline: DeviceTest = {
  id: 'd1.map-offline',
  title: 'Çevrimdışı harita: yollar, binalar ve etiketler görünüyor',
  kind: 'manual',
  question: 'Uçak modundayken Harita sekmesinde Kadıköy çevresinde yollar, binalar ve yazılar görünüyor mu?',
  async run() {
    return { outcome: 'skip' };
  },
};

export const d1MapLabels: DeviceTest = {
  id: 'd1.map-labels-tr',
  title: 'Türkçe karakterli etiketler doğru görünüyor',
  kind: 'manual',
  question: 'Haritadaki yer adlarında ı, İ, ş, ğ, ü, ö, ç harfleri doğru çıkıyor mu? Dil düğmesini en ve ar yapınca etiketler değişiyor mu?',
  async run() {
    return { outcome: 'skip' };
  },
};

export const d1MapDark: DeviceTest = {
  id: 'd1.map-dark',
  title: 'Koyu tema çalışıyor',
  kind: 'manual',
  question: 'Koyu tema düğmesi haritayı koyu renge çeviriyor ve yazılar okunuyor mu?',
  async run() {
    return { outcome: 'skip' };
  },
};

const detailQuestion = (label: string): string =>
  `Haritada alttaki ${label} düğmesi seçiliyken (Kadıköy, yakınlaştırılmış açılır) yollar, binalar ve yazılar görünüyor mu? Boş ya da yarım kalıyorsa Hayır de, notta ne gördüğünü yaz.`;

const detailTest = (name: string, title: string): DeviceTest => ({
  id: `d1.detail-${name}`,
  title,
  kind: 'manual',
  question: detailQuestion(`"istanbul-${name}"`),
  async run() {
    return { outcome: 'skip' };
  },
});

export const d1DetailKadikoy = detailTest('kadikoy', 'Kadıköy paketi (5,9 MB): yakında ayrıntı görünüyor');
export const d1DetailOrtaA = detailTest('orta-a', 'Orta A paketi (10,8 MB, alt dizinsiz): yakında ayrıntı görünüyor');
export const d1DetailOrtaB = detailTest('orta-b', 'Orta B paketi (alt dizinli): yakında ayrıntı görünüyor');

export const d1DetailFlat = detailTest('flat', 'Düzleştirilmiş İstanbul (84 MB, alt dizinsiz): yakında ayrıntı görünüyor');

export const d1MapIstanbul: DeviceTest = {
  id: 'd1.map-istanbul',
  title: 'Tüm İstanbul paketi (84 MB): yakında ayrıntı görünüyor',
  kind: 'manual',
  question: detailQuestion('"istanbul"'),
  async run() {
    return { outcome: 'skip' };
  },
};

const fontTest = (name: 'original' | 'compact'): DeviceTest => ({
  id: `d1.font-${name}`,
  title: `Yazı: ${name} seçiliyken harita yazıları görünüyor`,
  kind: 'manual',
  question: `Haritada Yazı: ${name} düğmesi seçiliyken yer adları ve sokak adları görünüyor mu? Görünmüyorsa Hayır de.`,
  async run() {
    return { outcome: 'skip' };
  },
});

export const d1FontOriginal = fontTest('original');
export const d1FontCompact = fontTest('compact');
