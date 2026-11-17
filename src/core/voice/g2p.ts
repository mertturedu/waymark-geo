const UPPER: Record<string, string> = {
  A: 'a', B: 'b', C: 'c', Ç: 'ç', D: 'd', E: 'e', F: 'f', G: 'g', Ğ: 'ğ', H: 'h', I: 'ı', İ: 'i', J: 'j', K: 'k', L: 'l', M: 'm',
  N: 'n', O: 'o', Ö: 'ö', P: 'p', Q: 'q', R: 'r', S: 's', Ş: 'ş', T: 't', U: 'u', Ü: 'ü', V: 'v', W: 'w', X: 'x', Y: 'y', Z: 'z',
  Â: 'a', Î: 'i', Û: 'u',
};

const BACK = 'aıou';
const FRONT = 'eiöü';
const VOWELS = BACK + FRONT + 'âîû';
const PUNCTUATION = ',.?!;:';

export function lowerTr(text: string): string {
  let out = '';
  for (const ch of text) out += UPPER[ch] ?? ch;
  return out;
}

function isVowel(ch: string | undefined): boolean {
  return ch !== undefined && ch !== '' && VOWELS.includes(ch);
}

function vowelBefore(word: string, from: number): string | undefined {
  for (let i = from; i >= 0; i--) if (isVowel(word[i])) return word[i];
  return undefined;
}

function isBack(ch: string | undefined): boolean {
  return ch !== undefined && 'aıouâû'.includes(ch);
}

function wordPhonemes(word: string): string[] {
  const out: string[] = [];
  const chars = word.split('');
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string;
    const next = chars[i + 1];
    const prev = chars[i - 1];
    if (next === ch && !isVowel(ch) && ch !== 'ğ') {
      out.push(...consonant(ch, word, i), 'ː');
      i += 1;
      continue;
    }
    if (isVowel(ch)) {
      out.push(vowel(ch));
      continue;
    }
    if (ch === 'ğ') {
      if (prev && isVowel(prev)) {
        if (isBack(prev) || !isVowel(next)) out.push('ː');
        else out.push('j');
      }
      continue;
    }
    out.push(...consonant(ch, word, i));
  }
  return out;
}

function vowel(ch: string): string {
  switch (ch) {
    case 'ı':
      return 'ɯ';
    case 'ö':
      return 'ø';
    case 'ü':
      return 'y';
    case 'â':
      return 'a';
    case 'î':
      return 'i';
    case 'û':
      return 'u';
    default:
      return ch;
  }
}

function consonant(ch: string, word: string, at: number): string[] {
  switch (ch) {
    case 'c':
      return ['d', 'ʒ'];
    case 'ç':
      return ['t', 'ʃ'];
    case 'ş':
      return ['ʃ'];
    case 'j':
      return ['ʒ'];
    case 'y':
      return ['j'];
    case 'q':
      return ['k'];
    case 'w':
      return ['v'];
    case 'x':
      return ['k', 's'];
    case 'g': {
      const following = word[at + 1];
      return [isVowel(following) && !isBack(following) ? 'ɟ' : 'ɡ'];
    }
    case 'l': {
      const around = isVowel(word[at + 1]) ? word[at + 1] : vowelBefore(word, at - 1);
      return [isBack(around) ? 'ɫ' : 'l'];
    }
    case 'r':
      return [isVowel(word[at + 1]) ? 'ɾ' : 'r'];
    default:
      return 'bdfhkmnpstvz'.includes(ch) ? [ch] : [];
  }
}

function stress(phonemes: string[]): string[] {
  let last = -1;
  phonemes.forEach((p, i) => {
    if ('aeiouɯøy'.includes(p) && p.length === 1) last = i;
  });
  if (last < 0) return phonemes;
  return [...phonemes.slice(0, last), 'ˈ', ...phonemes.slice(last)];
}

export function phonemize(text: string): string {
  const out: string[] = [];
  let word = '';
  const flush = () => {
    if (!word) return;
    if (out.length && out[out.length - 1] !== ' ') out.push(' ');
    out.push(...stress(wordPhonemes(word)));
    word = '';
  };
  for (const ch of lowerTr(text)) {
    if (ch === "'" || ch === '’') continue;
    if (VOWELS.includes(ch) || 'bcçdfgğhjklmnpqrsştvwxyz'.includes(ch)) {
      word += ch;
      continue;
    }
    flush();
    if (PUNCTUATION.includes(ch)) out.push(ch);
    else if (out.length && out[out.length - 1] !== ' ') out.push(' ');
  }
  flush();
  return out.join('').replace(/ +/g, ' ').trim();
}
