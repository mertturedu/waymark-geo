const PATTERNS: [string, RegExp][] = [
  ['normalize', /\.normalize\s*\(/],
  ['toLocaleLowerCase', /\.toLocaleLowerCase\s*\(/],
  ['toLocaleUpperCase', /\.toLocaleUpperCase\s*\(/],
  ['toLowerCase', /\.toLowerCase\s*\(/],
  ['toUpperCase', /\.toUpperCase\s*\(/],
  ['Intl', /\bIntl\b/],
  ['\\p{', /\\p\{/],
  ['\\P{', /\\P\{/],
];

export const findForbidden = (source: string): string[] => PATTERNS.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
