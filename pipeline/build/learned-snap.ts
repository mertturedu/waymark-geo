import type { Buildings2 } from '../../src/core/address/buildings2';
import type { LngLat } from '../../src/core/geo/cells';
import { distanceM, projectOnLine } from '../../src/core/geo/distance';

export const SNAP_REACH_M = 20;
export const SNAP_INSIDE_M = 1.5;

export function snapToBuilding(reader: Buildings2): (point: LngLat) => Promise<LngLat> {
  return async (point) => {
    if (await reader.at(point, 0.5)) return point;
    const found = (await reader.near(point, SNAP_REACH_M, 1))[0]?.building;
    if (!found || found.ring.length < 3) return point;
    const edge = projectOnLine(point, [...found.ring, found.ring[0] as LngLat]).point;
    const toward = distanceM(edge, found.center);
    if (toward < SNAP_INSIDE_M) return found.center;
    const share = SNAP_INSIDE_M / toward;
    return [edge[0] + (found.center[0] - edge[0]) * share, edge[1] + (found.center[1] - edge[1]) * share];
  };
}
