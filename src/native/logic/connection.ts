import type { ConnectionKind } from '../../core/packs/ports';

export function kindOfNetwork(type: string | undefined): ConnectionKind {
  if (type === 'CELLULAR') return 'cellular';
  if (type === 'NONE') return 'none';
  return 'wifi';
}
