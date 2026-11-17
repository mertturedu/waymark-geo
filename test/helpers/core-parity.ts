import { decodeLine, decodeRings, encodeLine, encodeRings, pointInRings, type Polygon, type Ring } from '../../src/core/region/geom';
import { createBorders, encodeBorders } from '../../src/core/region/borders';
import { parseManifest, serializeManifest } from '../../src/core/region/manifest';
import { houseNumberKey, splitNumbers } from '../../src/core/text/number';
import { CELL_SCALE, cellOf, cellsAround, cellsOfLine } from '../../src/core/geo/cells';
import { distanceM, lineLengthM, pointAlong, projectOnLine } from '../../src/core/geo/distance';
import { formatLabel } from '../../src/core/address/label';
import { editDistance, kindFactor, nameScore } from '../../src/core/address/names';
import { synonymVariants } from '../../src/core/address/synonyms';
import { numberAsWords } from '../../src/core/text/digits';
import { streetKey, streetLabel } from '../../src/core/text/street';
import { correctionLines, reviewImport } from '../../src/core/learn/corrections';
import { composeKey, learnKey } from '../../src/core/learn/key';
import { mergeConfirmations } from '../../src/core/learn/merge';
import type { Confirmation, ConfirmSource } from '../../src/core/learn/types';
import { decodePostings, encodePostings, trigramCodes } from '../../src/core/text/trigram';

export const NUMBER_CASES = [
  '14', '351/32A', '12 A', '12 / 3', '12/A', '5-7', '٣٤', '۱۲', '12А', 'No: 7', '012', '351/032A', '0', '-', 'yok', '', '   ', '1'.repeat(101), '1234567890123',
  'ı12', 'İ5', '٢٣ ب', '7К', 'A12', '12;14', ' 3 ; 4 ;', 'Ünal 9', '10/B-C', '5‏', '5​6', '１２',
];

export const POLYGON_CASES: Polygon[][] = [
  [[[[28.5, 40.5], [29.5, 40.5], [29.5, 41.5], [28.5, 41.5], [28.5, 40.5]], [[28.8, 40.8], [29.1, 40.8], [29.1, 41.1], [28.8, 41.1], [28.8, 40.8]]]],
  [[[[-179.9999996, -89.0000004], [180, -89], [180, 89.1234567], [-179.9999996, -89.0000004]]]],
  [],
];

export const POINT_CASES: [number, number][] = [[29, 41], [28.9, 40.9], [28.5, 41], [30, 41], [28.8, 40.95], [29.5, 41.5]];

const SAMPLE_MANIFEST = {
  format: 1,
  minSdk: '0.1.0',
  osm: { file: 'turkey-261020.osm.pbf', time: '2026-10-20T20:23:47Z' },
  tiles: { build: '20261022', time: '2026-10-22T04:00:00Z' },
  base: [{ kind: 'base', path: 'base-20261022/overview.pmtiles', size: 9, sha256: 'a'.repeat(64) }],
  regions: [{ id: '34', tier: 'full', names: { tr: 'İstanbul', ar: 'إسطنبول' }, bbox: [27.9, 40.7, 30, 41.7], version: '20261020.20261022', stats: { addresses: 1, streets: 2, neighbourhoods: 3 }, files: [{ kind: 'address', path: '34/address-1a2b3c4d.sqlite', size: 5, sha256: 'b'.repeat(64) }] }],
};

const NAME_PAIRS: [string, string][] = [['ataturk', 'atatrk'], ['bahariye caddesi', 'bahariye'], ['1707. sokak', '1708. sokak'], ['yildiz sokak', 'yildiz sokagi'], ['gul', 'gulsen'], ['sekizinci', '8'], ['kadikoy belediyesi', 'belediye'], ['', 'a'], ['mimar sinan', 'sinan mimar']];
const LABEL_CASES = [{ street: 'Bahariye Caddesi', houseNumber: '14', neighbourhood: 'Moda', district: 'Kadıköy', province: 'İstanbul' }, { poiName: 'Devlet Hastanesi', district: 'Kadıköy', province: 'İstanbul', postcode: '34710' }, { province: 'İstanbul' }];

const SOURCES_CYCLE: ConfirmSource[] = ['delivery', 'pin', 'delivery', 'manual'];

const mergeCases = (): Confirmation[][] =>
  Array.from({ length: 24 }, (_, c) =>
    Array.from({ length: 1 + (c % 6) }, (_, i): Confirmation => ({
      source: SOURCES_CYCLE[(c + i) % 4] as ConfirmSource,
      lng: 32.85 + ((c * 7 + i * 13) % 17) * 0.00012 + (i === 2 && c % 3 === 0 ? 0.004 : 0),
      lat: 39.93 + ((c * 11 + i * 5) % 13) * 0.00009,
      ...(i % 2 === 0 ? { accuracyM: 4 + ((c + i * 3) % 9) * 6 } : {}),
      at: 1_700_000_000 + c * 100 + i,
    })),
  );

const settle = (value: number): number => Math.round(value * 1e8) / 1e8;

const nameKeyOf = (text: string): string => streetKey(text).key;

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => (b < 16 ? '0' : '') + b.toString(16)).join('');

export function computeParity(): unknown {
  const line: Ring = [[28.600001, 40.900001], [28.7, 40.9], [28.9, 40.95]];
  return {
    numbers: NUMBER_CASES.map((raw) => [splitNumbers(raw), houseNumberKey(raw)]),
    polygons: POLYGON_CASES.map((polygons) => {
      const bytes = encodeRings(polygons);
      return [hex(bytes), decodeRings(bytes), POINT_CASES.map((p) => pointInRings(p, polygons))];
    }),
    line: [hex(encodeLine(line)), decodeLine(encodeLine(line))],
    trigrams: ['ataturk', 'a', '', '\u06ff', '\u0700ab', 'حي', 'uskudar 12'].map((key) => trigramCodes(key)),
    postings: [[1, 5, 5, 300, 70000, 2_000_000_000], [], [0]].map((ids) => [hex(encodePostings(ids)), decodePostings(encodePostings(ids))]),
    borders: (() => {
      const bytes = encodeBorders([{ plate: '34', rings: POLYGON_CASES[0] as Polygon[] }, { plate: '06', rings: [[[[32, 39.5], [33, 39.5], [33, 40.5], [32, 40.5], [32, 39.5]]]] }]);
      const open = createBorders(bytes);
      return [hex(bytes), open.plates(), open.provinceBounds('34'), POINT_CASES.map(([x, y]) => open.provinceAt(x, y))];
    })(),
    names: NAME_PAIRS.map(([a, b]) => [editDistance(a, b, 2), nameScore(streetKey(a), streetKey(b)), kindFactor(streetKey(a).kind, streetKey(b).kind, false)]),
    geo: (() => {
      const path: [number, number][] = [[28.6, 40.7], [28.6031, 40.7012], [28.61, 40.7]];
      return [
        CELL_SCALE, cellOf(28.604, 40.7), cellOf(29.0, 41.0), cellsOfLine(path), cellsAround([28.6035, 40.7001], 50),
        distanceM(path[0] as [number, number], path[2] as [number, number]), lineLengthM(path), pointAlong(path, 120), projectOnLine([28.602, 40.7005], path),
      ];
    })(),
    labels: (['tr', 'en', 'de', 'ar', 'ru', 'el'] as const).map((lang) => LABEL_CASES.map((c) => formatLabel(c, lang))),
    synonyms: ['kadikoy belediye binasi', 'devlet krankenhaus', nameKeyOf('Государственная больница'), 'akasya alisveris merkezi', 'bahariye'].map((key) => synonymVariants(key)),
    words: [1, 8, 10, 21, 99, 100].map((n) => numberAsWords(n)),
    labels2: ['Olmayan Sokak', 'Gül Ağacı Caddesi', 'Atatürk Bulvarı', '1707. Sokak', 'Kuyumcu Çıkmaz', 'Cumhuriyet Meydanı', 'Moda'].map((name) => { const k = streetKey(name); return streetLabel({ key: k.key, kind: k.kind }); }),
    learn: (() => {
      const cases = mergeCases();
      const lines = cases.map((confirmations, i) => JSON.stringify({ v: 1, key: composeKey({ region: '06', district: 'cankaya', neighbourhood: 'kizilay', street: `gul~sokak`, houseNumber: String(i + 1) }), region: '06', text: 'metin', confirmations }));
      const review = reviewImport([lines.slice(0, 12), lines.slice(8)]);
      const place = { id: 'x', label: 'x', components: { district: 'Çankaya', neighbourhood: 'Kızılay', street: 'Gül Sokak', houseNumber: '7/A' }, coordinate: [32, 39] as [number, number], precision: 'street' as const, approximate: true, source: 'derived' as const, confidence: 1, region: '06' };
      return {
        merges: cases.map((list) => {
          const m = mergeConfirmations(list);
          return m && [settle(m.coordinate[0]), settle(m.coordinate[1]), m.trusted, m.count, m.used, m.outliers, Math.round(m.spreadM * 1000) / 1000];
        }),
        key: learnKey(place),
        review: [review.accepted.map((r) => [r.key, settle(r.lng), settle(r.lat), r.count]), review.flagged, review.skippedLines],
        lines: correctionLines(review.accepted).length,
      };
    })(),
    manifest: serializeManifest(parseManifest(JSON.stringify(SAMPLE_MANIFEST))),
  };
}
