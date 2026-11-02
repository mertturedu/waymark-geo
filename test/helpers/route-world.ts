import { buildRoutePack } from '../../pipeline/build/route-pack';
import type { RoadRows } from '../../pipeline/build/route-graph';
import { readRoutePack, type RoutePack } from '../../src/core/route/format';

export function makePack(input: RoadRows, ferries = false): { pack: RoutePack; bytes: Uint8Array; graph: ReturnType<typeof buildRoutePack>['graph'] } {
  const built = buildRoutePack(input, { ferries });
  return { pack: readRoutePack(built.bytes), bytes: built.bytes, graph: built.graph };
}
