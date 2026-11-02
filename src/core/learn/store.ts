export type StoreRow = { key: string; value: string };

export interface LearnStore {
  readAll(): Promise<StoreRow[]>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  close?(): Promise<void>;
}

export function memoryStore(): LearnStore & { snapshot(): Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    async readAll() {
      return [...rows].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, value]) => ({ key, value }));
    },
    async write(key, value) {
      rows.set(key, value);
    },
    async remove(key) {
      rows.delete(key);
    },
    snapshot: () => new Map(rows),
  };
}
