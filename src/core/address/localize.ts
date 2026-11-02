import { districtNames, findDistrict, provinceNames } from '../text/admin';
import type { Region } from './pack';
import type { Components } from './types';

export function pickName(names: Partial<Record<string, string>> | null | undefined, lang: string, fallback: string): string {
  if (!names) return fallback;
  return names[lang] ?? (lang === 'tr' ? undefined : names.en) ?? names.tr ?? fallback;
}

export function localizeComponents(ctx: { language: string; region: Pick<Region, 'id' | 'hoods'> }, components: Components): Components {
  const lang = ctx.language;
  if (lang === 'tr') return components;
  const out: Components = { ...components };
  const plate = ctx.region.id;
  if (components.province) out.province = pickName(provinceNames(plate), lang, components.province);
  if (components.district) {
    const id = findDistrict(components.district, plate)[0]?.id;
    out.district = pickName(id ? districtNames(id) : null, lang, components.district);
  }
  if (components.neighbourhood) {
    const hood = ctx.region.hoods.find((h) => h.name === components.neighbourhood);
    out.neighbourhood = pickName(hood?.names, lang, components.neighbourhood);
  }
  return out;
}
