import { useCallback, useRef, useState } from 'react';
import type { LngLat } from '../../core/geo/cells';
import { MAX_STOPS, type PlanResult, type StopInput } from '../../core/plan/types';
import { emptyPlan, markVisited, move, removeStop, togglePin, toRequest, withOrder, type PlanState } from '../logic/plan-view';
import { useGeo } from './GeoProvider';

export type PlanControls = {
  state: PlanState;
  result: PlanResult | null;
  busy: boolean;
  nextLeg: number;
  addStop(point: LngLat, label?: string): void;
  removeStop(id: string): void;
  moveStop(from: number, to: number): void;
  togglePin(id: string): void;
  visit(id: string): void;
  setStart(id: string | null, point?: LngLat | null): void;
  setEnd(end: PlanState['end']): void;
  link(before: string, after: string): void;
  sort(budgetMs?: number): Promise<PlanResult>;
  sortRemaining(from: LngLat, budgetMs?: number): Promise<PlanResult>;
  measure(): Promise<PlanResult>;
  clear(): void;
};

export function usePlan(initial?: PlanState): PlanControls {
  const geo = useGeo();
  const [state, setState] = useState<PlanState>(initial ?? emptyPlan());
  const [result, setResult] = useState<PlanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const counter = useRef(0);
  const latest = useRef(state);
  latest.current = state;

  const update = useCallback((next: (current: PlanState) => PlanState) => {
    const value = next(latest.current);
    latest.current = value;
    setState(value);
    setResult(null);
  }, []);

  const run = useCallback(
    async (from: PlanState, mode: 'optimize' | 'keep', budgetMs?: number): Promise<PlanResult> => {
      setBusy(true);
      try {
        const done = await geo.plan.plan(toRequest(from, mode, budgetMs));
        setResult(done);
        if (done.ok && mode === 'optimize') {
          setState((current) => withOrder(current, done.order));
          latest.current = withOrder(latest.current, done.order);
        }
        return done;
      } finally {
        setBusy(false);
      }
    },
    [geo],
  );

  return {
    state,
    result,
    busy,
    nextLeg: state.visited.length,
    addStop: (point, label) => {
      if (latest.current.stops.length >= MAX_STOPS) return;
      counter.current += 1;
      const stop: StopInput = { id: `d${Date.now().toString(36)}${counter.current}`, point, ...(label ? { label } : {}) };
      update((current) => ({ ...current, stops: [...current.stops, stop] }));
    },
    removeStop: (id) => update((current) => removeStop(current, id)),
    moveStop: (from, to) => update((current) => ({ ...current, stops: move(current.stops, from, to) })),
    togglePin: (id) => update((current) => togglePin(current, id)),
    visit: (id) => update((current) => markVisited(current, id)),
    setStart: (id, point = null) => update((current) => ({ ...current, startId: id, startPoint: id ? null : point })),
    setEnd: (end) => update((current) => ({ ...current, end })),
    link: (before, after) => update((current) => ({ ...current, links: [...current.links.filter((l) => l.before !== before || l.after !== after), { before, after }] })),
    sort: (budgetMs) => run(latest.current, 'optimize', budgetMs),
    sortRemaining: (from, budgetMs) => run({ ...latest.current, startId: null, startPoint: from }, 'optimize', budgetMs),
    measure: () => run(latest.current, 'keep'),
    clear: () => {
      setState(emptyPlan());
      latest.current = emptyPlan();
      setResult(null);
    },
  };
}
