import type { Place } from '../../../../src/core';
import { createGeoNative } from '../../../../src/native';
import type { DeviceTest } from '../../device-test/types';
import { PUBLIC_KEY } from '../../sdk/server';
import { sandbox } from '../sandbox';

type Snapshot = { source: string; precision: string; coordinate: [number, number]; floor: { value: number; low: number; high: number; source: string } | null };
type Case = { id: string; text: string; truth: [number, number]; before: Snapshot | null; after: Snapshot | null };

const PLATE = '41';
const M_PER_DEGREE = 111_195;
const round = (n: number): number => Math.round(n * 1e6) / 1e6;

function snapshot(place: Place | undefined): Snapshot | null {
  if (!place) return null;
  const floor = place.unit?.floor ?? null;
  return { source: place.source, precision: place.precision, coordinate: [round(place.coordinate[0]), round(place.coordinate[1])], floor: floor ? { value: floor.value, low: floor.low, high: floor.high, source: floor.source } : null };
}

const meters = (a: [number, number], b: [number, number]): number => Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180) * M_PER_DEGREE, (a[1] - b[1]) * M_PER_DEGREE);
const median = (values: number[]): number => (values.length === 0 ? 0 : ([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number));

export const sdkAddrLearned: DeviceTest = {
  id: 'sdk.addr-learned',
  title: 'Merkezi öğrenme: yeni teslimler ertesi hafta katmanda kapı, sokak ve bina düzeni olarak bulunur; sonuçlar Node ile aynı',
  kind: 'auto',
  async run(ctx) {
    const base = `${ctx.packServerUrl}/learned-release`;
    const response = await fetch(`${base}/set.json`);
    if (!response.ok) return { outcome: 'fail', note: `sürüm klasörü yok (HTTP ${response.status}); scripts/build-learned-device-set.ts çalıştırılmalı ve sunucu yeniden başlatılmalı` };
    const set = (await response.json()) as { plate: string; cases: Case[] };
    const geo = await createGeoNative({ manifestUrl: `${base}/manifest-v1.json`, publicKeys: PUBLIC_KEY ? [PUBLIC_KEY] : [], directory: sandbox('addr-learned', true) });
    try {
      const checked = await geo.regions.checkUpdates();
      if (!checked.ok) return { outcome: 'fail', note: `manifest: ${checked.code}` };
      const run = async (pick: 'before' | 'after'): Promise<{ mismatches: string[]; snapshots: Map<string, Snapshot | null> }> => {
        const mismatches: string[] = [];
        const snapshots = new Map<string, Snapshot | null>();
        for (const c of set.cases) {
          const result = await geo.search.resolve(c.text);
          const place = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
          const got = snapshot(place);
          snapshots.set(c.id, got);
          if (JSON.stringify(got) !== JSON.stringify(c[pick])) mismatches.push(`${c.id}: ${JSON.stringify(got)} ≠ ${JSON.stringify(c[pick])}`);
        }
        return { mismatches, snapshots };
      };

      await geo.regions.download(PLATE, { parts: ['address', 'directory', 'buildings2'] });
      if (geo.regions.status(PLATE).installedParts.includes('learned')) return { outcome: 'fail', note: 'öğrenilmiş parça istenmeden kuruldu' };
      const before = await run('before');
      if (before.mismatches.length > 0) return { outcome: 'fail', note: `öğrenmeden önce Node ile ${before.mismatches.length} fark: ${before.mismatches[0]}` };

      await geo.regions.download(PLATE, { parts: ['address', 'directory', 'buildings2', 'learned'] });
      if (!geo.regions.status(PLATE).installedParts.includes('learned')) return { outcome: 'fail', note: 'öğrenilmiş parça kurulmadı' };
      const after = await run('after');
      if (after.mismatches.length > 0) return { outcome: 'fail', note: `öğrenilmiş parçadan sonra Node ile ${after.mismatches.length} fark: ${after.mismatches[0]}` };

      const doors = set.cases.filter((c) => c.id.startsWith('door-'));
      const floors = set.cases.filter((c) => c.id.startsWith('floor-'));
      const learned = doors.filter((c) => after.snapshots.get(c.id)?.source === 'learned');
      const errorBefore = doors.map((c) => meters(before.snapshots.get(c.id)?.coordinate ?? [0, 0], c.truth));
      const errorAfter = learned.map((c) => meters(after.snapshots.get(c.id)?.coordinate as [number, number], c.truth));
      const layouts = floors.filter((c) => after.snapshots.get(c.id)?.floor?.source === 'learned');
      if (learned.length < doors.length / 2) return { outcome: 'fail', note: `kapıların yalnız ${learned.length}/${doors.length} kadarı öğrenilmiş geldi` };
      if (layouts.length < floors.length) return { outcome: 'fail', note: `kat düzeni ${layouts.length}/${floors.length} binada geldi` };
      return { outcome: 'pass', value: String(learned.length), unit: `/${doors.length} kapı`, note: `öğrenmeden önce ortanca ${median(errorBefore).toFixed(0)} m, sonra ${median(errorAfter).toFixed(1)} m (${learned.length} öğrenilmiş sonuç); ${layouts.length}/${floors.length} binada öğrenilmiş kat; ${set.cases.length} vaka Node ile aynı` };
    } finally {
      await geo.dispose();
    }
  },
};
