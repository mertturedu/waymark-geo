import { Directory, File, Paths } from 'expo-file-system';

export type Settings = { lang: string; theme: 'light' | 'dark' };

const DEFAULTS: Settings = { lang: 'tr', theme: 'light' };

const folder = () => new Directory(Paths.document, 'geo-state');
const fileOf = () => new File(folder(), 'sdk-settings.json');

export async function loadSettings(): Promise<Settings> {
  try {
    const file = fileOf();
    if (!file.exists) return DEFAULTS;
    const raw = JSON.parse(await file.text()) as Partial<Settings>;
    return { lang: typeof raw.lang === 'string' ? raw.lang : DEFAULTS.lang, theme: raw.theme === 'dark' ? 'dark' : 'light' };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    if (!folder().exists) folder().create({ intermediates: true, idempotent: true });
    const file = fileOf();
    if (!file.exists) file.create();
    file.write(JSON.stringify(settings));
  } catch {
    return;
  }
}
