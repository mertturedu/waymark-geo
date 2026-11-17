import { ROAD_CLASSES, type RoadClass } from '../../src/core/route/speeds';
import type { BaseEdge, BaseGraph } from './route-graph';

export const LAST_SEGMENT_CLASS: RoadClass = 'tertiary_link';
export const MAX_SEGMENT_M = 600;
export const MIN_SEGMENT_M = 60;
export const NO_SEGMENT = -1;

const LAST_INDEX = ROAD_CLASSES.indexOf(LAST_SEGMENT_CLASS);
const MAIN_JUNCTION = 3;
const MICRO = 1e6;

export type TrafficSegment = { key: string; cls: number; oneway: boolean; lengthM: number; edges: number[]; line: number[] };

export type TrafficSegments = { segments: TrafficSegment[]; edgeSegment: Int32Array; edgeFlip: Uint8Array };

export const isSegmentClass = (cls: number): boolean => cls >= 0 && cls <= LAST_INDEX;

export const channelOf = (set: TrafficSegments, pa: number): number => {
  const segment = set.edgeSegment[pa >> 1] as number;
  return segment === NO_SEGMENT ? NO_SEGMENT : 2 * segment + ((pa & 1) ^ (set.edgeFlip[pa >> 1] as number));
};

type Step = { edge: number; flip: boolean };

const TAIL = 0;
const HEAD = 1;

function lineOf(base: BaseGraph, steps: Step[]): number[] {
  const line: number[] = [];
  steps.forEach(({ edge, flip }, i) => {
    const e = base.edges[edge] as BaseEdge;
    const from = flip ? e.head : e.tail;
    const to = flip ? e.tail : e.head;
    if (i === 0) line.push(base.nodeLon[from] as number, base.nodeLat[from] as number);
    if (flip) for (let k = e.shape.length - 2; k >= 0; k -= 2) line.push(e.shape[k] as number, e.shape[k + 1] as number);
    else line.push(...e.shape);
    line.push(base.nodeLon[to] as number, base.nodeLat[to] as number);
  });
  return line;
}

function mergeShort(base: BaseGraph, groups: Step[][]): Step[][] {
  const length = (group: Step[]): number => group.reduce((sum, step) => sum + (base.edges[step.edge] as BaseEdge).lengthM, 0);
  const out: Step[][] = [];
  for (const group of groups) {
    const last = out[out.length - 1];
    if (last && length(group) < MIN_SEGMENT_M) last.push(...group);
    else out.push([...group]);
  }
  if (out.length > 1 && length(out[0] as Step[]) < MIN_SEGMENT_M) {
    const [head, next, ...rest] = out as [Step[], Step[], ...Step[][]];
    return [[...head, ...next], ...rest];
  }
  return out;
}

export function buildTrafficSegments(base: BaseGraph): TrafficSegments {
  const count = base.edges.length;
  const main = (index: number): boolean => isSegmentClass((base.edges[index] as BaseEdge).cls);
  const oneway = (e: BaseEdge): boolean => e.forward !== e.backward;
  const nodeAt = (e: BaseEdge, end: number): number => (end === TAIL ? e.tail : e.head);
  const entersAt = (e: BaseEdge, end: number): boolean => (end === HEAD ? e.forward : e.backward);

  const touching = new Map<number, number[]>();
  for (let index = 0; index < count; index++) {
    if (!main(index)) continue;
    const e = base.edges[index] as BaseEdge;
    for (const end of [TAIL, HEAD]) {
      const list = touching.get(nodeAt(e, end));
      if (list) list.push(2 * index + end);
      else touching.set(nodeAt(e, end), [2 * index + end]);
    }
  }
  const mainDegree = (node: number): number => touching.get(node)?.length ?? 0;

  const link = new Int32Array(2 * count).fill(-1);
  const join = (a: number, b: number): void => {
    link[a] = b;
    link[b] = a;
  };
  for (const list of base.wayEdges.values()) {
    for (let i = 1; i < list.length; i++) {
      const previous = list[i - 1] as number;
      const next = list[i] as number;
      if (main(previous) && main(next) && (base.edges[previous] as BaseEdge).head === (base.edges[next] as BaseEdge).tail && previous !== next) join(2 * previous + HEAD, 2 * next + TAIL);
    }
  }
  for (const ends of touching.values()) {
    if (ends.length !== 2) continue;
    const [a, b] = ends as [number, number];
    if (link[a] !== -1 || link[b] !== -1 || a >> 1 === b >> 1) continue;
    const first = base.edges[a >> 1] as BaseEdge;
    const second = base.edges[b >> 1] as BaseEdge;
    if (first.cls !== second.cls || oneway(first) !== oneway(second)) continue;
    if (oneway(first) && entersAt(first, a & 1) === entersAt(second, b & 1)) continue;
    join(a, b);
  }

  const walk = (edge: number, from: number): Step[] => {
    const steps: Step[] = [];
    let at = edge;
    let entry = from;
    for (;;) {
      steps.push({ edge: at, flip: entry === HEAD });
      const out = link[2 * at + (1 - entry)] as number;
      if (out === -1 || out >> 1 === edge) return steps;
      at = out >> 1;
      entry = out & 1;
    }
  };

  const done = new Uint8Array(count);
  const strokes: Step[][] = [];
  const take = (steps: Step[]): void => {
    const first = base.edges[(steps[0] as Step).edge] as BaseEdge;
    const against = oneway(first) && (steps[0] as Step).flip === first.forward;
    const ordered = against ? steps.map((step) => ({ edge: step.edge, flip: !step.flip })).reverse() : steps;
    for (const step of ordered) done[step.edge] = 1;
    strokes.push(ordered);
  };
  const endOsm = (steps: Step[], last: boolean): number => {
    const step = steps[last ? steps.length - 1 : 0] as Step;
    const e = base.edges[step.edge] as BaseEdge;
    return base.nodeOsm[step.flip !== last ? e.head : e.tail] as number;
  };
  for (let index = 0; index < count; index++) {
    if (!main(index) || done[index] === 1) continue;
    const openTail = link[2 * index + TAIL] === -1;
    const openHead = link[2 * index + HEAD] === -1;
    if (!openTail && !openHead) continue;
    const steps = walk(index, openTail ? TAIL : HEAD);
    const twoWay = !oneway(base.edges[index] as BaseEdge);
    take(twoWay && endOsm(steps, true) < endOsm(steps, false) ? steps.map((step) => ({ edge: step.edge, flip: !step.flip })).reverse() : steps);
  }
  for (let index = 0; index < count; index++) if (main(index) && done[index] === 0) take(walk(index, TAIL));

  const segments: TrafficSegment[] = [];
  const edgeSegment = new Int32Array(count).fill(NO_SEGMENT);
  const edgeFlip = new Uint8Array(count);
  const seen = new Map<string, number>();
  for (const stroke of strokes) {
    const groups: Step[][] = [];
    let open: Step[] = [];
    let lengthM = 0;
    for (const step of stroke) {
      const e = base.edges[step.edge] as BaseEdge;
      open.push(step);
      lengthM += e.lengthM;
      if (mainDegree(step.flip ? e.tail : e.head) >= MAIN_JUNCTION || lengthM >= MAX_SEGMENT_M) {
        groups.push(open);
        open = [];
        lengthM = 0;
      }
    }
    if (open.length > 0) groups.push(open);
    for (const steps of mergeShort(base, groups)) {
      const start = steps[0] as Step;
      const first = base.edges[start.edge] as BaseEdge;
      const osm = base.nodeOsm[start.flip ? first.head : first.tail] as number;
      const plain = `${first.way}:${osm >= 0 ? osm : `#${first.seq}`}`;
      const repeat = seen.get(plain) ?? 0;
      seen.set(plain, repeat + 1);
      const index = segments.length;
      for (const step of steps) {
        edgeSegment[step.edge] = index;
        edgeFlip[step.edge] = step.flip ? 1 : 0;
      }
      segments.push({
        key: repeat === 0 ? plain : `${plain}~${repeat}`,
        cls: first.cls,
        oneway: oneway(first),
        lengthM: steps.reduce((sum, step) => sum + (base.edges[step.edge] as BaseEdge).lengthM, 0),
        edges: steps.map((step) => step.edge),
        line: lineOf(base, steps),
      });
    }
  }
  return { segments, edgeSegment, edgeFlip };
}

const ZOOM_FROM: Partial<Record<RoadClass, number>> = { motorway: 6, trunk: 6, primary: 8, secondary: 10, tertiary: 11 };
const LINK_FROM = 12;
export const SEGMENT_TILE_ZOOMS = { min: 6, max: 14 } as const;
export const SEGMENT_LAYER = 'traffic';

export function segmentFeature(segment: TrafficSegment, index: number): string {
  const coordinates: [number, number][] = [];
  for (let i = 0; i + 1 < segment.line.length; i += 2) coordinates.push([(segment.line[i] as number) / MICRO, (segment.line[i + 1] as number) / MICRO]);
  const cls = ROAD_CLASSES[segment.cls] as RoadClass;
  return JSON.stringify({
    type: 'Feature',
    tippecanoe: { minzoom: ZOOM_FROM[cls] ?? LINK_FROM },
    properties: { s: index, c: segment.cls, d: segment.oneway ? 1 : 0 },
    geometry: { type: 'LineString', coordinates },
  });
}

export const segmentTileCommand = (source: string, target: string): string =>
  `tippecanoe -o '${target}' -l ${SEGMENT_LAYER} -Z${SEGMENT_TILE_ZOOMS.min} -z${SEGMENT_TILE_ZOOMS.max} --force --no-tile-size-limit --no-feature-limit --simplify-only-low-zooms --quiet '${source}'`;
