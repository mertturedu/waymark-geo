import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readMeasures } from '../tools/compare/measures';
import type { Gate } from './engine';

const QUERIES = 10_000;
const MAX_MINUTES = 30;
const MAX_MINI_MINUTES = 10;
const MIN_NOMINATIM = 88;
const MIN_NOMINATIM_PLATE = 85;
const CATEGORIES = ['ayrıştırma', 'mahalle', 'sokak', 'kapı', 'yer'];

type Measure<T> = T | undefined;

const measure = <T>(key: string): Measure<T> => readMeasures()[key] as Measure<T>;

const queueDirs = (): string[] => {
  const root = join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'adres-kiyas');
  return existsSync(root) ? readdirSync(root).map((day) => join(root, day, 'g2')).filter(existsSync) : [];
};

export const adres1Gates: Gate[] = [
  {
    id: 'A1.1',
    phase: 1,
    title: 'Tüm motorlar addr-compare ile çalışıyor; 10.000 kayıt (SDK, Nominatim, Photon) soğuk önbellekle ≤ 30 dk',
    kind: 'auto',
    threshold: `≥ ${QUERIES} kayıt, ≤ ${MAX_MINUTES} dk`,
    async measure() {
      const m = measure<{ records: number; seconds: number }>('a1_1');
      if (!m) return { status: 'open', measured: 'hız ölçümü koşulmadı' };
      const measured = `${m.records} kayıt, ${(m.seconds / 60).toFixed(1)} dk`;
      return m.records >= QUERIES && m.seconds <= MAX_MINUTES * 60 ? { status: 'pass', measured } : { status: 'fail', measured };
    },
  },
  {
    id: 'A1.2',
    phase: 1,
    title: 'Nominatim kendi OSM kapılarımızın büyük bölümünü tam adresle buluyor (kurulum doğrulaması)',
    kind: 'auto',
    threshold: `toplam ≥ %${MIN_NOMINATIM}, her ilde ≥ %${MIN_NOMINATIM_PLATE} (≤ 30 m)`,
    async measure() {
      const m = measure<{ within30: number; count: number; per: Record<string, number> }>('a1_2');
      if (!m) return { status: 'open', measured: 'koşulmadı' };
      const measured = `${m.count} kapı, toplam %${m.within30}; ${Object.entries(m.per).map(([k, v]) => `${k}: %${v}`).join(', ')}`;
      const ok = m.within30 >= MIN_NOMINATIM && Object.values(m.per).every((v) => v >= MIN_NOMINATIM_PLATE);
      return { status: ok ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A1.3',
    phase: 1,
    title: 'Dil modeli etiket doğruluğu, doğru bileşeni bilinen G2 kayıtlarında raporlandı ve model seçildi',
    kind: 'auto',
    threshold: 'iki model ölçüldü, biri seçildi',
    async measure() {
      const m = measure<{ selected: string; models: Record<string, { count: number; accuracy: number; ms: number }> }>('a1_3');
      if (!m || Object.keys(m.models).length < 2) return { status: 'open', measured: 'model ölçümü yok' };
      const text = Object.entries(m.models).map(([k, v]) => `${k}: %${v.accuracy} (${v.count}, ${v.ms} ms)`).join('; ');
      return { status: m.selected ? 'pass' : 'fail', measured: `seçilen ${m.selected}; ${text}` };
    },
  },
  {
    id: 'A1.4',
    phase: 1,
    title: 'Farklılık kuyruğu raporu üretildi (beş tür)',
    kind: 'auto',
    threshold: 'ayrıştırma, mahalle, sokak, kapı, yer dosyaları',
    async measure() {
      const dirs = queueDirs();
      const complete = dirs.filter((dir) => CATEGORIES.every((c) => existsSync(join(dir, `${c}.json`))));
      return complete.length > 0 ? { status: 'pass', measured: `${complete.length} günlük kuyruk` } : { status: 'fail', measured: 'kuyruk dosyası yok' };
    },
  },
  {
    id: 'A1.5',
    phase: 1,
    title: 'Mini dünya (34, 16, 35) adres hattı ≤ 10 dk',
    kind: 'auto',
    threshold: `≤ ${MAX_MINI_MINUTES} dk`,
    async measure() {
      const m = measure<{ seconds: number }>('a1_5');
      if (!m) return { status: 'open', measured: 'ölçülmedi' };
      const measured = `${(m.seconds / 60).toFixed(1)} dk`;
      return { status: m.seconds <= MAX_MINI_MINUTES * 60 ? 'pass' : 'fail', measured };
    },
  },
];
