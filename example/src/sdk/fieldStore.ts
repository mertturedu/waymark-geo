import { File, Paths } from 'expo-file-system';

export type FieldRecord = { id: string; at: number; text: string; point: [number, number]; source: 'gps' | 'map'; accuracyM: number | null; floor?: string; door?: string; note?: string; device?: string; sent?: boolean };

const file = (): File => new File(Paths.document, 'saha-g0.json');

export function loadField(): FieldRecord[] {
  try {
    const f = file();
    return f.exists ? (JSON.parse(f.textSync()) as FieldRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveField(records: FieldRecord[]): void {
  const f = file();
  if (!f.exists) f.create();
  f.write(JSON.stringify(records));
}

export const unsent = (records: FieldRecord[]): FieldRecord[] => records.filter((r) => !r.sent);

export const forUpload = (records: FieldRecord[]): Omit<FieldRecord, 'sent'>[] => records.map(({ sent: _sent, ...rest }) => rest);
