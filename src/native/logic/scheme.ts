export type ThemePreference = 'light' | 'dark' | 'auto';

export function resolveScheme(preference: ThemePreference, system: string | null | undefined): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') return preference;
  return system === 'dark' ? 'dark' : 'light';
}
