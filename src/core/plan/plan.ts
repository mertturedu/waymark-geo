import type { LngLat } from '../geo/cells';
import { EXACT_LIMIT, solveExact } from './exact';
import { solveHeuristic } from './heuristic';
import type { Problem } from './problem';
import { feasibleOrder, obeys, type Rules } from './rules';
import { MAX_STOPS, type PlanDeps, type PlanLeg, type PlanRequest, type PlanResult, type PlanWarning, type StopInput, type Unreachable } from './types';

const SAME_SPOT = 1e-5;
const DEFAULT_SEED = 20261030;

const bad = (detail: string): PlanResult => ({ ok: false, code: 'INVALID_REQUEST', detail });
const conflict = (detail: string): PlanResult => ({ ok: false, code: 'CONSTRAINT_CONFLICT', detail });

const spot = (point: LngLat): string => `${Math.round(point[0] / SAME_SPOT)}|${Math.round(point[1] / SAME_SPOT)}`;

const validPoint = (point: unknown): point is LngLat =>
  Array.isArray(point) && point.length === 2 && typeof point[0] === 'number' && typeof point[1] === 'number' && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;

function check(request: PlanRequest): PlanResult | null {
  if (!request || !Array.isArray(request.stops)) return bad('durak listesi yok');
  if (request.stops.length > MAX_STOPS) return { ok: false, code: 'TOO_MANY_STOPS', detail: `en çok ${MAX_STOPS} durak` };
  const ids = new Set<string>();
  for (const stop of request.stops) {
    if (!stop || typeof stop.id !== 'string' || stop.id === '') return bad('durak kimliği boş');
    if (ids.has(stop.id)) return bad(`kimlik tekrarlanıyor: ${stop.id}`);
    if (!validPoint(stop.point)) return bad(`geçersiz konum: ${stop.id}`);
    ids.add(stop.id);
  }
  const known = (id: string): boolean => ids.has(id);
  if (request.start && 'stopId' in request.start && !known(request.start.stopId)) return bad('başlangıç durağı listede yok');
  if (request.start && 'point' in request.start && !validPoint(request.start.point)) return bad('geçersiz başlangıç konumu');
  if (request.end && request.end.kind === 'stop' && !known(request.end.stopId)) return bad('bitiş durağı listede yok');
  if (request.end && request.end.kind === 'return' && !request.start) return bad('dönüş için başlangıç gerekir');
  for (const pin of request.pins ?? []) {
    if (!known(pin.stopId)) return bad(`sabitlenen durak listede yok: ${pin.stopId}`);
    if (!Number.isInteger(pin.position) || pin.position < 0) return bad(`geçersiz sıra: ${pin.stopId}`);
  }
  for (const link of request.precedence ?? []) if (!known(link.before) || !known(link.after) || link.before === link.after) return bad('geçersiz alış-teslim çifti');
  for (const id of request.visited ?? []) if (!known(id)) return bad(`gidilmiş durak listede yok: ${id}`);
  if (request.mode !== undefined && request.mode !== 'optimize' && request.mode !== 'keep') return bad('geçersiz kip');
  return null;
}

type Node = { id: string; point: LngLat; followers: string[] };

export async function planStops(request: PlanRequest, deps: PlanDeps): Promise<PlanResult> {
  const invalid = check(request);
  if (invalid) return invalid;
  const visited = new Set(request.visited ?? []);
  const vehicleOption = request.vehicle ? { vehicle: request.vehicle } : undefined;
  const warnings: PlanWarning[] = [];
  const byId = new Map(request.stops.map((s) => [s.id, s]));

  const startStopId = request.start && 'stopId' in request.start ? request.start.stopId : null;
  const startPoint: LngLat | null = request.start ? ('point' in request.start ? request.start.point : (byId.get(request.start.stopId) as StopInput).point) : null;
  const startIsStop = startStopId !== null && !visited.has(startStopId);

  let endKind: 'free' | 'return' | 'stop' = request.end?.kind ?? 'free';
  let endStop = request.end?.kind === 'stop' ? request.end.stopId : null;
  if (endKind === 'stop' && endStop === startStopId) {
    endKind = 'return';
    endStop = null;
  }
  if (endKind === 'stop' && endStop !== null && visited.has(endStop)) return conflict('bitiş durağı gidilmiş');

  const remaining = request.stops.filter((s) => !visited.has(s.id) && !(startIsStop && s.id === startStopId));
  const merged: { id: string; into: string }[] = [];
  const mergedInto = new Map<string, string>();
  const nodes: Node[] = [];
  const atSpot = new Map<string, Node>();
  const head: Node = { id: startStopId !== null && startIsStop ? startStopId : '', point: startPoint ?? [0, 0], followers: [] };
  if (startPoint) atSpot.set(spot(startPoint), head);
  for (const stop of remaining) {
    const key = spot(stop.point);
    const twin = atSpot.get(key);
    if (twin) {
      twin.followers.push(stop.id);
      mergedInto.set(stop.id, twin.id === '' ? '' : twin.id);
      merged.push({ id: stop.id, into: twin.id });
      continue;
    }
    const node: Node = { id: stop.id, point: stop.point, followers: [] };
    atSpot.set(key, node);
    nodes.push(node);
  }
  const representative = (id: string): string | null => {
    if (visited.has(id)) return null;
    if (id === startStopId && startIsStop) return id;
    return mergedInto.has(id) ? (mergedInto.get(id) as string) : id;
  };

  const sorted = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pointsForMatrix: LngLat[] = [...(startPoint ? [startPoint] : []), ...sorted.map((n) => n.point)];
  const unreachable: Unreachable[] = [];
  let approximate = false;
  let costs: { time: (number | null)[][]; dist: (number | null)[][] } | null = null;
  let usable: Node[] = sorted;

  if (pointsForMatrix.length >= 2) {
    const result = await deps.matrix(pointsForMatrix, vehicleOption);
    if (!result.ok) {
      if (result.code === 'START_OUTSIDE_REGION' || result.code === 'PACK_DAMAGED') return { ok: false, code: result.code };
      return { ok: false, code: 'ROUTE_FAILED', detail: result.code };
    }
    approximate = result.approximate;
    const offset = startPoint ? 1 : 0;
    if (startPoint && !(result.stops[0] as { ok: boolean }).ok) return { ok: false, code: 'ROUTE_FAILED', detail: 'başlangıç yola oturmadı' };
    const keep: number[] = startPoint ? [0] : [];
    const dropped = new Set<string>();
    sorted.forEach((node, i) => {
      const state = result.stops[i + offset] as (typeof result.stops)[number];
      if (!state.ok) {
        unreachable.push({ id: node.id, reason: state.reason });
        dropped.add(node.id);
        for (const f of node.followers) unreachable.push({ id: f, reason: state.reason });
        return;
      }
      if (state.warnings.some((w) => w.code === 'far_snap')) warnings.push({ code: 'far_snap', stopId: node.id });
      keep.push(i + offset);
    });
    const anchor = startPoint ? 0 : keep.reduce((best, i) => (result.durationS[i]?.filter((v) => v !== null).length ?? 0) > (result.durationS[best]?.filter((v) => v !== null).length ?? 0) ? i : best, keep[0] ?? 0);
    const linked = keep.filter((i) => i === anchor || (result.durationS[anchor]?.[i] != null && result.durationS[i]?.[anchor] != null));
    for (const i of keep) {
      if (linked.includes(i) || i === 0 && startPoint) continue;
      const node = sorted[i - offset] as Node;
      unreachable.push({ id: node.id, reason: 'disconnected' });
      for (const f of node.followers) unreachable.push({ id: f, reason: 'disconnected' });
      dropped.add(node.id);
    }
    const finalKeep = keep.filter((i) => linked.includes(i) || (i === 0 && startPoint !== null));
    usable = sorted.filter((n) => !dropped.has(n.id));
    const pick = (matrix: (number | null)[][]): (number | null)[][] => finalKeep.map((a) => finalKeep.map((b) => (matrix[a] as (number | null)[])[b] as number | null));
    costs = { time: pick(result.durationS), dist: pick(result.distanceM) };
  }

  const nodeIndex = new Map(usable.map((n, i) => [n.id, i]));
  const rootOf = (id: string): string | null => {
    const root = representative(id);
    return root === null ? null : root;
  };
  const offsetSlot = startIsStop ? 1 : 0;
  const pins = new Map<number, number>();
  const dropRule = (id: string): void => void warnings.push({ code: 'rule_dropped', stopId: id });
  const requested: { id: string; position: number }[] = [...(request.pins ?? []).map((p) => ({ id: p.stopId, position: p.position }))];
  if (endKind === 'stop' && endStop !== null) requested.push({ id: endStop, position: Number.POSITIVE_INFINITY });
  const lastSlot = usable.length - 1;
  for (const pin of requested) {
    const root = rootOf(pin.id);
    if (root === null) continue;
    if (root === startStopId && startIsStop) {
      if (pin.position !== 0 && Number.isFinite(pin.position)) return conflict('başlangıç durağı ilk sırada olmalı');
      continue;
    }
    const index = nodeIndex.get(root);
    if (index === undefined) {
      if (pin.id === endStop) {
        warnings.push({ code: 'end_unreachable', stopId: pin.id });
        endStop = null;
        if (endKind === 'stop') endKind = 'free';
      } else dropRule(pin.id);
      continue;
    }
    const slot = Number.isFinite(pin.position) ? pin.position - offsetSlot : lastSlot;
    if (slot < 0 || slot > lastSlot) return conflict(`sıra aralık dışı: ${pin.id}`);
    if (pins.has(index) && pins.get(index) !== slot) return conflict(`aynı durak iki sıraya sabitlenmiş: ${pin.id}`);
    pins.set(index, slot);
  }
  const before: [number, number][] = [];
  for (const link of request.precedence ?? []) {
    const a = rootOf(link.before);
    const b = rootOf(link.after);
    if (a === null && b === null) continue;
    if (b === null) return conflict(`teslim edilmiş durak alıştan önce: ${link.after}`);
    if (a === null) continue;
    const startFirst = startIsStop && (a === startStopId || b === startStopId);
    if (startFirst) {
      if (b === startStopId) return conflict(`başlangıç durağı ilk sırada, önce gelmesi istenen: ${link.before}`);
      continue;
    }
    const ia = nodeIndex.get(a);
    const ib = nodeIndex.get(b);
    if (ia === undefined || ib === undefined) {
      dropRule(ia === undefined ? link.before : link.after);
      continue;
    }
    if (ia === ib) return conflict(`aynı noktadaki iki durak sıralanamaz: ${link.before}`);
    before.push([ia, ib]);
  }
  const rules: Rules = { size: usable.length, pins, before };

  let sequence: number[] = [];
  let strategy: 'exact' | 'heuristic' | 'keep' | 'none' = 'none';
  if (usable.length === 1 && costs === null) {
    sequence = [0];
    strategy = request.mode === 'keep' ? 'keep' : 'exact';
  } else if (usable.length > 0) {
    if (request.mode === 'keep') {
      sequence = request.stops.map((s) => nodeIndex.get(rootOf(s.id) ?? '')).filter((i): i is number => i !== undefined).filter((i, k, all) => all.indexOf(i) === k);
      strategy = 'keep';
      if (!obeys(sequence, rules)) {
        const at = new Map(sequence.map((n, k) => [n, k]));
        for (const [a, b] of before) if ((at.get(a) as number) >= (at.get(b) as number)) warnings.push({ code: 'order_breaks_rule', stopId: (usable[b] as Node).id });
        for (const [n, slot] of pins) if (at.get(n) !== slot) warnings.push({ code: 'order_breaks_rule', stopId: (usable[n] as Node).id });
      }
    } else {
      if (feasibleOrder(rules) === null) return conflict('kurallar birlikte sağlanamıyor');
      const hasDepot = startPoint !== null;
      const t = (costs as NonNullable<typeof costs>).time;
      const cell = (a: number, b: number): number => {
        const v = (t[a] as (number | null)[])[b];
        return v === null || v === undefined ? 1e9 : (v as number);
      };
      const base = hasDepot ? 1 : 0;
      const problem: Problem = {
        size: usable.length,
        from: usable.map((_, i) => (hasDepot ? cell(0, i + base) : 0)),
        between: usable.map((_, i) => usable.map((__, j) => cell(i + base, j + base))),
        back: endKind === 'return' && hasDepot ? usable.map((_, i) => cell(i + base, 0)) : null,
        rules,
      };
      const solved =
        usable.length <= EXACT_LIMIT
          ? solveExact(problem)
          : solveHeuristic(problem, { now: deps.now, ms: request.budgetMs ?? (usable.length <= 50 ? 800 : 2500), seed: request.seed ?? DEFAULT_SEED });
      if (solved === null) return conflict('kurallar birlikte sağlanamıyor');
      sequence = solved;
      strategy = usable.length <= EXACT_LIMIT ? 'exact' : 'heuristic';
    }
  }

  const order: string[] = [];
  if (startIsStop) {
    order.push(startStopId as string, ...head.followers);
  } else {
    order.push(...head.followers);
  }
  const visits: { id: string; point: LngLat }[] = [];
  for (const index of sequence) {
    const node = usable[index] as Node;
    order.push(node.id, ...node.followers);
    visits.push({ id: node.id, point: node.point });
  }

  const legs: PlanLeg[] = [];
  let totalDistanceM = 0;
  let totalDurationS = 0;
  let previous: { id: string | null; point: LngLat } | null = startPoint ? { id: startIsStop ? (startStopId as string) : null, point: startPoint } : null;
  const closing = endKind === 'return' && startPoint ? { id: startIsStop ? (startStopId as string) : null, point: startPoint } : null;
  const targets: { id: string | null; point: LngLat }[] = [...visits, ...(closing && visits.length > 0 ? [{ id: closing.id, point: closing.point }] : [])];
  for (const target of targets) {
    if (previous) {
      const route = await deps.route(previous.point, target.point, vehicleOption);
      if (!route.ok) return { ok: false, code: 'ROUTE_FAILED', detail: route.code };
      legs.push({ from: previous.id, to: target.id, distanceM: route.distanceM, durationS: route.durationS, geometry: route.geometry });
      totalDistanceM += route.distanceM;
      totalDurationS += route.durationS;
      if (route.approximate) approximate = true;
    }
    previous = { id: target.id, point: target.point };
  }

  return { ok: true, order, legs, totalDistanceM, totalDurationS, unreachable, merged, warnings, approximate, strategy };
}
