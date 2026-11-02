export type ConfirmSource = 'pin' | 'delivery' | 'manual';

export type Confirmation = { source: ConfirmSource; lng: number; lat: number; accuracyM?: number; at: number };

export type LearnedRecord = { v: number; key: string; region: string; text: string; confirmations: Confirmation[] };

export const SCHEMA_VERSION = 1;
export const SOURCES: readonly ConfirmSource[] = ['pin', 'delivery', 'manual'];
export const ALLOWED_FIELDS: readonly string[] = ['v', 'key', 'region', 'text', 'confirmations'];
export const ALLOWED_CONFIRMATION_FIELDS: readonly string[] = ['source', 'lng', 'lat', 'accuracyM', 'at'];
