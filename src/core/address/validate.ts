import { nameKey } from '../text/fold';
import { upperTr } from '../text/upper';
import type { Lang, ParsedAddress } from '../text/types';
import type { PostcodeCheck } from './neighbourhoods';
import { standardAddress, type StandardAddress } from './standard';
import type { Place, ResolveResult } from './types';
import { kindText, noteText, statusText, type NoteCode, type ValidationStatus } from './validate-text';

export type Severity = 'info' | 'warning' | 'error';
export type FixField = 'district' | 'neighbourhood' | 'street' | 'number' | 'unit' | 'region' | 'postcode';
export type Fix = { field: FixField; value: string | null; options?: string[]; address?: string };
export type ValidationNote = { code: NoteCode; severity: Severity; field: FixField; message: string; fix?: Fix };
export type Suggestions = { street?: string; neighbourhood?: string; district?: string };

export type Validation = {
  status: ValidationStatus;
  statusText: string;
  notes: ValidationNote[];
  place: Place | null;
  kind: string | null;
  standard: StandardAddress | null;
  suggestions: Suggestions;
  candidates: Place[];
};

export const HOOD_CONFIDENCE_MAX = 0.84;
const TIE = 0.1;
const OPTIONS = 5;

const SEVERITY: Record<NoteCode, Severity> = {
  missing_neighbourhood: 'warning',
  missing_number: 'warning',
  district_mismatch: 'error',
  street_not_in_neighbourhood: 'error',
  number_out_of_range: 'error',
  number_not_on_street: 'error',
  parity_side_unknown: 'info',
  ambiguous_street: 'warning',
  outside_installed_regions: 'error',
  block_not_found: 'error',
  floor_out_of_range: 'error',
  door_out_of_range: 'error',
  floor_door_mismatch: 'error',
  landmark_not_in_building: 'info',
  relation_not_found: 'info',
  postcode_mismatch: 'warning',
};

const FIELD: Record<NoteCode, FixField> = {
  missing_neighbourhood: 'neighbourhood',
  missing_number: 'number',
  district_mismatch: 'district',
  street_not_in_neighbourhood: 'neighbourhood',
  number_out_of_range: 'number',
  number_not_on_street: 'number',
  parity_side_unknown: 'number',
  ambiguous_street: 'street',
  outside_installed_regions: 'region',
  block_not_found: 'unit',
  floor_out_of_range: 'unit',
  door_out_of_range: 'unit',
  floor_door_mismatch: 'unit',
  landmark_not_in_building: 'street',
  relation_not_found: 'street',
  postcode_mismatch: 'postcode',
};

const PASSED: ReadonlySet<string> = new Set(['number_out_of_range', 'block_not_found', 'floor_out_of_range', 'door_out_of_range', 'floor_door_mismatch', 'landmark_not_in_building', 'relation_not_found']);
const AREA_ONLY: ReadonlySet<string> = new Set(['province', 'district', 'neighbourhood']);

const title = (key: string): string => key.split(' ').map((w) => (w === '' ? w : upperTr(w.charAt(0)) + w.slice(1))).join(' ');

export function analyse(input: { parsed: ParsedAddress; result: ResolveResult; language: Lang; suggestions?: Suggestions; postcode?: PostcodeCheck | null }): Validation {
  const { parsed, result, language } = input;
  const suggestions: Suggestions = { ...(input.suggestions ?? {}) };
  const note = (code: NoteCode, values: { given?: string; found?: string } = {}, fix?: Fix): ValidationNote => ({ code, severity: SEVERITY[code], field: FIELD[code], message: noteText(code, language, values), ...(fix ? { fix } : {}) });
  if (result.status === 'region_missing') {
    return { status: 'not_found', statusText: statusText('not_found', language), notes: [note('outside_installed_regions', {}, { field: 'region', value: null, options: result.regions })], place: null, kind: null, standard: null, suggestions, candidates: [] };
  }
  const candidates = result.status === 'resolved' ? [result.best, ...result.candidates.filter((c) => c.id !== result.best.id)] : result.candidates;
  const withSuggestion = 'suggestion' in result && result.suggestion?.components.street ? { ...suggestions, street: result.suggestion.components.street } : suggestions;
  const best = candidates[0];
  if (!best) return { status: 'not_found', statusText: statusText('not_found', language), notes: [], place: null, kind: null, standard: null, suggestions: withSuggestion, candidates: [] };

  const notes: ValidationNote[] = [];
  const bestHood = best.components.neighbourhood ? nameKey(best.components.neighbourhood) : null;
  const bestDistrict = best.components.district ? nameKey(best.components.district) : null;
  const typedStreet = parsed.street !== null;
  const typedNumber = parsed.houseNumber !== null;
  const fixed = standardAddress(best, language).text;

  const districtWrong = (parsed.district !== null && !parsed.district.ambiguous && bestDistrict !== null && nameKey(parsed.district.name) !== bestDistrict && !AREA_ONLY.has(best.precision)) || (best.notes ?? []).includes('district_mismatch');
  if (districtWrong) notes.push(note('district_mismatch', { given: parsed.district?.name ?? '', found: best.components.district ?? '' }, { field: 'district', value: best.components.district ?? null, address: fixed }));
  else if (typedStreet && parsed.neighbourhood && bestHood !== null && best.components.street && nameKey(parsed.neighbourhood) !== bestHood && best.confidence <= HOOD_CONFIDENCE_MAX) {
    notes.push(note('street_not_in_neighbourhood', { given: title(parsed.neighbourhood), found: best.components.neighbourhood ?? '' }, { field: 'neighbourhood', value: best.components.neighbourhood ?? null, address: fixed }));
  }

  if (input.postcode) notes.push(note('postcode_mismatch', { given: input.postcode.typed, found: input.postcode.expected.join(', ') }, { field: 'postcode', value: input.postcode.expected[0] ?? null, options: input.postcode.expected }));

  if (typedStreet && typedNumber && best.precision === 'street' && best.components.street) notes.push(note('number_not_on_street'));
  if (typedStreet && !typedNumber && (best.precision === 'street' || best.precision === 'neighbourhood' || best.precision === 'district')) notes.push(note('missing_number', {}, { field: 'number', value: null }));

  if (typedStreet && result.status === 'ambiguous') {
    const near = candidates.filter((c) => c.confidence >= best.confidence - TIE && c.components.street !== undefined);
    const districts = [...new Set(near.map((c) => c.components.district ?? ''))];
    const hoods = [...new Set(near.map((c) => c.components.neighbourhood ?? ''))].filter((h) => h !== '');
    if (districts.length > 1 && !parsed.district) notes.push(note('ambiguous_street', {}, { field: 'district', value: null, options: districts.slice(0, OPTIONS) }));
    else if (hoods.length > 1 && !parsed.neighbourhood) notes.push(note('missing_neighbourhood', {}, { field: 'neighbourhood', value: null, options: hoods.slice(0, OPTIONS) }));
    else if (near.length > 1 && districts.length > 1) notes.push(note('ambiguous_street', {}, { field: 'street', value: null, options: districts.slice(0, OPTIONS) }));
  }

  for (const code of [...(best.notes ?? []), ...(best.unit?.notes ?? [])]) if (PASSED.has(code) && !notes.some((n) => n.code === code)) notes.push(note(code as NoteCode));
  if (typedNumber && best.precision === 'interpolated' && best.radiusM === undefined && best.relation === undefined) notes.push(note('parity_side_unknown'));

  const status: ValidationStatus = notes.some((n) => n.severity === 'error') ? 'conflict' : notes.some((n) => n.severity === 'warning') ? 'incomplete' : 'ok';
  return { status, statusText: statusText(status, language), notes, place: best, kind: kindText(best.precision, language), standard: standardAddress(best, language), suggestions: withSuggestion, candidates };
}
