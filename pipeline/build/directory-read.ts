import { nameKey } from '../../src/core/text/fold';
import { houseNumberKey } from '../../src/core/text/number';
import { parseAddress } from '../../src/core/text/parse';
import { streetKey, streetLabel } from '../../src/core/text/street';

export type Reading = { street: string | null; number: string | null; hood: string | null };

const STRUCTURE = /(^| )(cd|cad|cadde|caddesi|sk|sok|sokak|sokagi|blv|bulvar|bulvari|mh|mah|mahalle|mahallesi|yol|yolu|cikmaz|cikmazi|meydan|meydani|no|numara)( |$)/;
const NUMBER_AFTER_NO = /(?:^|[^a-z])(?:no|numara|nu)\s*[:.]?\s*(\d{1,5}\s?[a-z]{0,2}(?:\/(?:\d{1,5}|[a-z]))?)(?![a-z0-9])/i;
const MAX_DOOR = 9999;

const DOOR_ONLY = /^\d{1,4}(?:\s*[/-]\s*\d{1,4})?\s*[a-z]?$|^\d{1,4}\s*\/\s*[a-z]$/;
const DOOR_FIRST = /^(\d{1,4}\s*\/\s*[a-z0-9]{1,3}|\d{1,4}\s?[a-z])\s+(?=\D)/i;
const NO_MARK = /\b(?:no|n)\s*[:./]\s*(?=\d)|\bn(?=\d)/gi;

export function structuredPart(raw: string): string {
  const parts = raw.split(/[,;|]/).map((p) => p.trim()).filter((p) => p !== '');
  const keyed = parts.map((text) => ({ text, key: nameKey(text) }));
  if (!keyed.some((p) => STRUCTURE.test(p.key))) return parts.join(', ');
  return keyed.filter((p) => STRUCTURE.test(p.key) || !/[a-z]/.test(p.key) || DOOR_ONLY.test(p.key)).map((p) => p.text).join(', ');
}

function loneDoor(text: string): string | null {
  const alone = text.split(/[,;|]/).map((p) => p.trim()).filter((p) => DOOR_ONLY.test(nameKey(p)) && /\d/.test(p) && !/^\d{5}$/.test(p));
  return alone.length === 1 ? (alone[0] as string) : null;
}

export function doorNumber(raw: string | null): string | null {
  if (raw === null) return null;
  let text = raw.trim().replace(/\s+/g, '').toUpperCase();
  const split = /^(\d+[A-Za-z]?)\/(\d{1,4}[A-Za-z]?)$/.exec(text);
  if (split) text = split[1] as string;
  const key = houseNumberKey(text);
  if (!key || key.int === null || key.int < 1 || key.int > MAX_DOOR) return null;
  return text;
}

const lower = (word: string): string => word.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();

function titled(word: string): string {
  const small = lower(word);
  const first = small.charAt(0);
  return (first === 'i' ? 'İ' : first.toUpperCase()) + small.slice(1);
}

function original(raw: string, wanted: string[]): string[] | null {
  const tokens = raw.split(/[\s,;|]+/).map((t) => t.replace(/^[.:()"']+|[.:()"']+$/g, '')).filter((t) => t !== '');
  const folded = tokens.map((t) => nameKey(t));
  for (let i = 0; i + wanted.length <= tokens.length; i++) {
    if (wanted.every((w, j) => folded[i + j] === w)) return tokens.slice(i, i + wanted.length);
  }
  return null;
}

export function streetDisplay(raw: string, street: { key: string; kind: Parameters<typeof streetLabel>[0]['kind'] }): string {
  const fallback = streetLabel(street);
  const words = original(raw, street.key.split(' '));
  if (!words) return fallback;
  const label = streetLabel({ key: '_', kind: street.kind }).replace(/^_ ?/, '');
  const text = [...words.map(titled), ...(label === '' ? [] : [label])].join(' ');
  return streetKey(text).key === streetKey(fallback).key ? text : fallback;
}

export function readAddress(raw: string | null): Reading {
  const empty: Reading = { street: null, number: null, hood: null };
  if (raw === null) return empty;
  let text = structuredPart(raw.replace(/_/g, ' ')).replace(NO_MARK, 'No:');
  if (text === '') return empty;
  const lead = DOOR_FIRST.exec(text.split(/[,;|]/)[0] ?? '');
  if (lead) text = text.slice(lead[0].length);
  const parsed = parseAddress(text);
  const street = parsed.street && parsed.street.kind !== null ? parsed.street : parsed.street && parsed.houseNumber ? parsed.street : null;
  const given = parsed.houseNumber ?? NUMBER_AFTER_NO.exec(text)?.[1] ?? (street ? (lead ? (lead[1] as string).replace(/\s+/g, '') : loneDoor(text)) : null);
  const hood = parsed.neighbourhood && parsed.neighbourhood.split(' ').length <= 3 ? parsed.neighbourhood : null;
  return { street: street ? streetDisplay(text, street) : null, number: doorNumber(given), hood };
}

export function readAll(addr: string | null, more: string[]): Reading[] {
  const seen = new Set<string>();
  const out: Reading[] = [];
  for (const text of [addr, ...more]) {
    const reading = readAddress(text);
    if (reading.street === null) continue;
    const key = `${nameKey(reading.street)}|${reading.number ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(reading);
  }
  return out;
}

export const bestReading = (readings: Reading[]): Reading => readings.find((r) => r.number !== null) ?? readings[0] ?? { street: null, number: null, hood: null };
