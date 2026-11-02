import type { LayerKey, LayerNeighbour, LayerPoint, LayerScope, PointLayer } from '../address/types';
import type { LngLat } from '../geo/cells';
import { distanceM } from '../geo/distance';
import { composeKey, scopeKey, scopeOfKey, textOfKey, validKey } from './key';
import { mergeConfirmations, OUTLIER_M, TRUST_SPREAD_M } from './merge';
import { migrate } from './migrate';
import type { Confirmation } from './types';

export type CorrectionRecord = { v: 1; key: string; region: string; text: string; lng: number; lat: number; count: number };
export type FlagReason = 'single' | 'untrusted' | 'conflict' | 'outlier' | 'spread';
export type Flag = { key: string; reason: FlagReason; detail: string };
export type Review = { accepted: CorrectionRecord[]; flagged: Flag[]; report: string; skippedLines: number };

const BOX = { west: 25.5, east: 45, south: 35.5, north: 42.5 };
const inBox = (lng: number, lat: number): boolean => lng >= BOX.west && lng <= BOX.east && lat >= BOX.south && lat <= BOX.north;
const idOf = (c: Confirmation): string => `${c.source},${c.lng},${c.lat},${c.at}`;
const pointOf = (c: { lng: number; lat: number }): LngLat => [c.lng, c.lat];
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

type Door = { region: string; files: Map<number, Confirmation[]> };

export function correctionLines(records: CorrectionRecord[]): string[] {
  return [...records].sort((a, b) => byText(a.key, b.key)).map((r) => JSON.stringify({ v: 1, key: r.key, region: r.region, text: r.text, lng: r.lng, lat: r.lat, count: r.count }));
}

function readDoors(inputs: string[][]): { doors: Map<string, Door>; skipped: number } {
  const doors = new Map<string, Door>();
  let skipped = 0;
  inputs.forEach((lines, file) => {
    for (const line of lines) {
      if (line.trim() === '') continue;
      const result = migrate(line);
      if ('skipped' in result) {
        skipped++;
        continue;
      }
      const { record } = result;
      const usable = record.confirmations.filter((c) => inBox(c.lng, c.lat));
      if (!validKey(record.key, record.region) || usable.length === 0) {
        skipped++;
        continue;
      }
      const door = doors.get(record.key) ?? { region: record.region, files: new Map() };
      door.files.set(file, [...(door.files.get(file) ?? []), ...usable]);
      doors.set(record.key, door);
    }
  });
  return { doors, skipped };
}

const WARNINGS: ReadonlySet<FlagReason> = new Set(['outlier', 'spread']);

function reportOf(accepted: number, flagged: Flag[], skipped: number, files: number): string {
  const warned = flagged.filter((f) => WARNINGS.has(f.reason)).length;
  const rows = flagged.map((f) => `| ${f.key} | ${f.reason} | ${f.detail} |`);
  return [
    '# Düzeltme içe aktarma raporu',
    '',
    `- Okunan dosya: ${files}`,
    `- ${accepted} anahtar kabul, ${flagged.length - warned} anahtar dışarıda, ${warned} uyarı`,
    ...(skipped > 0 ? [`- ${skipped} satır okunamadı`] : []),
    '',
    ...(rows.length > 0 ? ['| Anahtar | Neden | Ayrıntı |', '|---|---|---|', ...rows] : ['Uyarı ve dışarıda kalan anahtar yok.']),
    '',
  ].join('\n');
}

export function reviewImport(inputs: string[][], options: { includeSingle?: boolean } = {}): Review {
  const { doors, skipped } = readDoors(inputs);
  const accepted: CorrectionRecord[] = [];
  const flagged: Flag[] = [];
  for (const key of [...doors.keys()].sort(byText)) {
    const door = doors.get(key) as Door;
    const seen = new Set<string>();
    const all: Confirmation[] = [];
    for (const list of door.files.values()) {
      for (const c of list) {
        if (seen.has(idOf(c))) continue;
        seen.add(idOf(c));
        all.push(c);
      }
    }
    const merged = mergeConfirmations(all) as NonNullable<ReturnType<typeof mergeConfirmations>>;
    const points = [...door.files.values()].map((list) => (mergeConfirmations(list) as NonNullable<ReturnType<typeof mergeConfirmations>>).coordinate);
    const apart = points.reduce((far, a) => points.reduce((f, b) => Math.max(f, distanceM(a, b)), far), 0);
    if (apart > OUTLIER_M) {
      flagged.push({ key, reason: 'conflict', detail: `dosyalar ${Math.round(apart)} m ayrı nokta veriyor` });
      continue;
    }
    const lone = all.length === 1 && all[0]?.source === 'delivery';
    if (lone || !merged.trusted) {
      if (lone && options.includeSingle) flagged.push({ key, reason: 'single', detail: '1 teslimat onayı, isteğe bağlı alındı' });
      else {
        flagged.push(lone ? { key, reason: 'single', detail: '1 teslimat onayı' } : { key, reason: 'untrusted', detail: `${all.length} onay, güvenilir değil` });
        continue;
      }
    }
    if (merged.outliers.length > 0) {
      const far = merged.outliers.reduce((m, i) => Math.max(m, distanceM(pointOf(all[i] as Confirmation), merged.coordinate)), 0);
      flagged.push({ key, reason: 'outlier', detail: `${merged.outliers.length} aykırı onay, en uzağı ${Math.round(far)} m` });
    }
    if (merged.trusted && merged.spreadM >= TRUST_SPREAD_M) flagged.push({ key, reason: 'spread', detail: `yayılma ${Math.round(merged.spreadM)} m` });
    accepted.push({ v: 1, key, region: door.region, text: textOfKey(key), lng: merged.coordinate[0], lat: merged.coordinate[1], count: all.length });
  }
  return { accepted, flagged, report: reportOf(accepted.length, flagged, skipped, inputs.length), skippedLines: skipped };
}

function readRecord(line: string): CorrectionRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.key !== 'string' || typeof r.region !== 'string' || typeof r.text !== 'string' || typeof r.lng !== 'number' || typeof r.lat !== 'number' || typeof r.count !== 'number') return null;
  if (!validKey(r.key, r.region) || !inBox(r.lng, r.lat) || !Number.isInteger(r.count) || r.count < 1) return null;
  return { v: 1, key: r.key, region: r.region, text: r.text, lng: r.lng, lat: r.lat, count: r.count };
}

export function createCorrections(lines: string[]): PointLayer {
  const points = new Map<string, LayerPoint>();
  const byStreet = new Map<string, Map<string, LayerNeighbour>>();
  for (const line of lines) {
    const record = readRecord(line);
    if (!record) continue;
    const point: LayerPoint = { coordinate: [record.lng, record.lat], trusted: true };
    points.set(record.key, point);
    const at = scopeOfKey(record.key);
    if (at) byStreet.set(at.scope, (byStreet.get(at.scope) ?? new Map()).set(record.key, { int: at.int, coordinate: point.coordinate, trusted: true }));
  }
  return {
    name: 'correction',
    async lookup(key: LayerKey) {
      return points.get(composeKey(key)) ?? null;
    },
    async nearby(scope: LayerScope) {
      return [...(byStreet.get(scopeKey(scope))?.values() ?? [])].sort((a, b) => a.int - b.int);
    },
  };
}
