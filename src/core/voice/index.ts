import { phonemize } from './g2p';
import { phonemesToIds, type PhonemeIdMap } from './ids';
import { normalizeText } from './normalize';

export { lowerTr, phonemize } from './g2p';
export { phonemesToIds, type PhonemeIdMap } from './ids';
export { normalizeText, numberWords, ordinalWords } from './normalize';

export function speechPhonemes(text: string): string {
  return phonemize(normalizeText(text));
}

export function speechIds(text: string, map: PhonemeIdMap): number[] {
  return phonemesToIds(speechPhonemes(text), map);
}
