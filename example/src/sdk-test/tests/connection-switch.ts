import type { ConnectionKind } from '../../../../src/core/packs/ports';

export type Switch = { kind(): Promise<ConnectionKind>; onChange(listener: (kind: ConnectionKind) => void): () => void; set(next: ConnectionKind): void };

export function connectionSwitch(first: ConnectionKind): Switch {
  let current = first;
  const listeners = new Set<(kind: ConnectionKind) => void>();
  return {
    kind: async () => current,
    onChange: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set(next) {
      current = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}
