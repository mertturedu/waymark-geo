export type SqlValue = string | number | null | Uint8Array;

export interface SqlDb {
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  close(): Promise<void>;
}

export interface PackStore {
  installed(): Promise<string[]>;
  open(region: string): Promise<SqlDb | null>;
  openPart?(region: string, kind: 'buildings' | 'directory'): Promise<SqlDb | null>;
}

export interface RouteStore {
  installed(): Promise<string[]>;
  read(region: string): Promise<Uint8Array | null>;
  onChange?(listener: (region: string) => void): () => void;
}
