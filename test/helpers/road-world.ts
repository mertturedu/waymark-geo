import type { RoadRows, RoadRule, RoadWay } from '../../pipeline/build/route-graph';
import type { RoadClass } from '../../src/core/route/speeds';

export type Pt = [id: number, lon: number, lat: number];

export function way(id: number, pts: Pt[], extra: Partial<Omit<RoadWay, 'id' | 'nodes' | 'coords'>> = {}): RoadWay {
  return { id, cls: 'residential' as RoadClass, oneway: '', speed: null, ferry: false, duration: null, nodes: pts.map((p) => p[0]), coords: pts.map((p) => [p[1], p[2]] as [number, number]), ...extra };
}

export function rows(ways: RoadWay[], rules: RoadRule[] = [], blocked: number[] = []): RoadRows {
  return { ways, rules, blocked: new Set(blocked) };
}

export const deg = (meters: number): number => meters / 111_195;
