export type PhonemeIdMap = Record<string, number[]>;

export function phonemesToIds(phonemes: string, map: PhonemeIdMap): number[] {
  const pad = map['_'] ?? [0];
  const ids: number[] = [...(map['^'] ?? [1]), ...pad];
  for (const ch of phonemes) {
    const id = map[ch];
    if (!id) continue;
    ids.push(...id, ...pad);
  }
  ids.push(...(map['$'] ?? [2]));
  return ids;
}
