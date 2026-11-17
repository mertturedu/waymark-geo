import profile from './data/ibb-istanbul.json';
import { observedByCell, observedSlowdown, type ObservedProfile } from './observed';

export type Sampler = (lat: number, lng: number) => number | null;

const ISTANBUL = profile as ObservedProfile;
const ISTANBUL_PLATE = '34';

export const observedSampler = (region: string, at: number): Sampler | null => (region === ISTANBUL_PLATE ? (lat, lng) => observedSlowdown(ISTANBUL, lat, lng, at) : null);

export const observedCells = (region: string, at: number): Record<string, number> | null => (region === ISTANBUL_PLATE ? observedByCell(ISTANBUL, at) : null);
