const MAP: Record<string, string> = { Ç: 'C', ç: 'c', Ğ: 'G', ğ: 'g', İ: 'I', ı: 'i', Ö: 'O', ö: 'o', Ş: 'S', ş: 's', Ü: 'U', ü: 'u' };

export const foldTurkish = (text: string): string => text.replace(/[ÇçĞğİıÖöŞşÜü]/g, (c) => MAP[c] ?? c);

const SHORT: Record<string, string> = { Caddesi: 'Cd.', Sokağı: 'Sk.', Sokak: 'Sk.', Mahallesi: 'Mah.', Bulvarı: 'Blv.' };

const abbreviate = (text: string): string =>
  text
    .split(' ')
    .map((word) => {
      const match = /^(.*?)([,;/]*)$/.exec(word);
      const core = match?.[1] ?? word;
      return `${SHORT[core] ?? core}${match?.[2] ?? ''}`;
    })
    .join(' ');

export type SpeedQuery<T> = T & { variant: 'golden' | 'folded' | 'abbreviated' };

export function speedQueries<T extends { text: string }>(golden: T[], count: number): SpeedQuery<T>[] {
  if (golden.length === 0 || count <= 0) return [];
  const out: SpeedQuery<T>[] = [];
  for (let i = 0; i < count; i++) {
    const source = golden[i % golden.length] as T;
    if (i < golden.length) out.push({ ...source, variant: 'golden' });
    else if (Math.floor(i / golden.length) % 2 === 1) out.push({ ...source, text: foldTurkish(source.text), variant: 'folded' });
    else out.push({ ...source, text: abbreviate(source.text), variant: 'abbreviated' });
  }
  return out;
}
