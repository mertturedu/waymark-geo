const LOWER = 'abcçdefgğhıijklmnoöpqrsştuüvwxyzâîûêôáàéèíìóòúùäëïñåøæœ';
const UPPER = 'ABCÇDEFGĞHIİJKLMNOÖPQRSŞTUÜVWXYZÂÎÛÊÔÁÀÉÈÍÌÓÒÚÙÄËÏÑÅØÆŒ';
const PAIRS: Record<string, string> = {};
for (let at = 0; at < LOWER.length; at += 1) PAIRS[LOWER[at] as string] = UPPER[at] as string;
PAIRS['ß'] = 'SS';
for (let code = 0x3b1; code <= 0x3c9; code += 1) if (code !== 0x3c2) PAIRS[String.fromCharCode(code)] = String.fromCharCode(code - 32);
PAIRS['ς'] = 'Σ';
for (const [low, up] of [['ά', 'Ά'], ['έ', 'Έ'], ['ή', 'Ή'], ['ί', 'Ί'], ['ό', 'Ό'], ['ύ', 'Ύ'], ['ώ', 'Ώ']] as const) PAIRS[low] = up;
for (let code = 0x430; code <= 0x44f; code += 1) PAIRS[String.fromCharCode(code)] = String.fromCharCode(code - 32);

export function upperTr(text: string): string {
  let out = '';
  for (const char of text) out += PAIRS[char] ?? char;
  return out;
}
