import type { AutoDecision } from '../../core/packs/region';

export type AutoRegionUpdate = { decision: AutoDecision; started: string[] };

const NOTHING: AutoDecision = { action: 'none', regions: [], neighbours: [] };

export function createAutoRegion(deps: {
  suggest(location: unknown): AutoDecision | Promise<AutoDecision>;
  download(id: string): Promise<void>;
  now(): number;
  retryMs: number;
}): { update(location: unknown): Promise<AutoRegionUpdate>; reset(): void } {
  const tried = new Map<string, number>();

  return {
    async update(location) {
      if (location === null || location === undefined) return { decision: NOTHING, started: [] };
      const decision = await deps.suggest(location);
      const started: string[] = [];
      if (decision.action !== 'download') return { decision, started };
      for (const id of decision.regions) {
        const last = tried.get(id);
        if (last !== undefined && last !== Number.POSITIVE_INFINITY && deps.now() - last < deps.retryMs) continue;
        if (last === Number.POSITIVE_INFINITY) continue;
        tried.set(id, Number.POSITIVE_INFINITY);
        started.push(id);
        deps.download(id).then(
          () => undefined,
          (error: unknown) => void tried.set(id, (error as { code?: unknown } | null)?.code === 'cancelled' ? Number.POSITIVE_INFINITY : deps.now()),
        );
      }
      return { decision, started };
    },
    reset() {
      tried.clear();
    },
  };
}
