import { readFileSync } from 'node:fs';
import { planStops } from '../src/core/plan/plan';
import type { PlanRequest, PlanResult } from '../src/core/plan/types';
import type { Router } from '../src/core/route/router';
import type { TryCommands } from './try';

export function formatPlan(request: PlanRequest, result: PlanResult): string[] {
  if (!result.ok) return [`hata: ${result.code}${result.detail ? ` (${result.detail})` : ''}`];
  const label = new Map(request.stops.map((s) => [s.id, s.label ?? s.id]));
  const minutes = (s: number): string => `${Math.round(s / 60)} dk`;
  const lines = [`${result.order.length} durak, ${(result.totalDistanceM / 1000).toFixed(1)} km, ${minutes(result.totalDurationS)} (${result.strategy})`];
  result.order.forEach((id, i) => lines.push(`${String(i + 1).padStart(3)}. ${label.get(id)}`));
  for (const u of result.unreachable) lines.push(`ulaşılamadı: ${label.get(u.id)} (${u.reason})`);
  for (const w of result.warnings) lines.push(`uyarı: ${w.code} ${label.get(w.stopId)}`);
  return lines;
}

export function planCommands(open: (packs?: string) => Promise<{ router: Router }>): TryCommands {
  return {
    async plan(args) {
      const json = args.includes('--json');
      const file = args.find((a) => !a.startsWith('--'));
      if (!file) {
        console.error('kullanım: plan <istek.json> [--json]  (istek: stops, start, end, pins, precedence, visited, mode)');
        process.exitCode = 2;
        return;
      }
      const request = JSON.parse(readFileSync(file, 'utf8')) as PlanRequest;
      const { router } = await open();
      const result = await planStops(request, { matrix: (p, o) => router.matrix(p, o), route: (a, b, o) => router.route(a, b, o), now: () => Date.now() });
      if (json) console.log(JSON.stringify(result, null, 2));
      else for (const line of formatPlan(request, result)) console.log(line);
    },
  };
}
