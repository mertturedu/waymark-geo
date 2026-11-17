import type { LngLat } from '../geo/cells';
import type { MatrixResult, RouteResult, Vehicle } from '../route/router';

export const MAX_STOPS = 100;

export type StopInput = { id: string; point: LngLat; label?: string };

export type PlanRequest = {
  stops: ReadonlyArray<StopInput>;
  start?: { stopId: string } | { point: LngLat };
  end?: { kind: 'free' } | { kind: 'return' } | { kind: 'stop'; stopId: string };
  pins?: ReadonlyArray<{ stopId: string; position: number }>;
  visited?: ReadonlyArray<string>;
  precedence?: ReadonlyArray<{ before: string; after: string }>;
  mode?: 'optimize' | 'keep';
  vehicle?: Vehicle;
  budgetMs?: number;
  seed?: number;
};

export type PlanLeg = { from: string | null; to: string | null; distanceM: number; durationS: number; geometry: LngLat[] };

export type PlanWarning =
  | { code: 'far_snap'; stopId: string }
  | { code: 'end_unreachable'; stopId: string }
  | { code: 'rule_dropped'; stopId: string }
  | { code: 'order_breaks_rule'; stopId: string };

export type Unreachable = { id: string; reason: 'no_road' | 'outside_region' | 'disconnected' };

export type PlanFailure = 'INVALID_REQUEST' | 'TOO_MANY_STOPS' | 'CONSTRAINT_CONFLICT' | 'START_OUTSIDE_REGION' | 'PACK_DAMAGED' | 'ROUTE_FAILED';

export type PlanResult =
  | {
      ok: true;
      order: string[];
      legs: PlanLeg[];
      totalDistanceM: number;
      totalDurationS: number;
      unreachable: Unreachable[];
      merged: { id: string; into: string }[];
      warnings: PlanWarning[];
      approximate: boolean;
      strategy: 'exact' | 'heuristic' | 'keep' | 'none';
    }
  | { ok: false; code: PlanFailure; detail?: string };

export type PlanDeps = {
  matrix(points: ReadonlyArray<LngLat>, options?: { vehicle?: Vehicle }): Promise<MatrixResult>;
  route(from: LngLat, to: LngLat, options?: { vehicle?: Vehicle }): Promise<RouteResult>;
  now(): number;
};
