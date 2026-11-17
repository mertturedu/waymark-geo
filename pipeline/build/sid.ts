import { createHash } from 'node:crypto';
import { nameKey } from '../../src/core/text/fold';

const digest = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 8);

export const osmSid = (plate: string, relation: string): string => `H${plate}R${relation.replace(/^[nwr]/, '')}`;
export const unitSid = (plate: string, districtKey: string, unitKey: string): string => `H${plate}${digest(`${plate}|${districtKey}|${unitKey}`)}`;

export const districtSidKey = (name: string): string => nameKey(name.replace(/\s+(İlçesi|Merkez)$/i, ''));

export const streetSid = (plate: string, key: string, kind: string | null): string => `S${plate}-${createHash('sha1').update(`${plate}|${key}|${kind ?? ''}`).digest('hex').slice(0, 10)}`;
