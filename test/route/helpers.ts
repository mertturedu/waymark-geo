import { sourceLabels, targetLabels } from '../../src/core/route/labels';
import type { RoutePack } from '../../src/core/route/format';
import type { Snap } from '../../src/core/route/snap';

export const labelsOf = (pack: RoutePack, snap: Snap) => ({ from: sourceLabels(pack, snap), to: targetLabels(pack, snap) });
