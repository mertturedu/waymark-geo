import type { IconGroup } from './theme';

export type GlyphRow = { name: string; source: string; group: IconGroup; tier: 1 | 2 | 3 | 4 };

export const GLYPH_TABLE: readonly GlyphRow[] = [
  { name: 'restaurant', source: 'maki:restaurant', group: 'food', tier: 4 },
  { name: 'cafe', source: 'maki:cafe', group: 'food', tier: 4 },
  { name: 'bakery', source: 'maki:bakery', group: 'food', tier: 4 },
  { name: 'fast-food', source: 'maki:fast-food', group: 'food', tier: 4 },
  { name: 'bar', source: 'maki:bar', group: 'food', tier: 4 },
  { name: 'grocery', source: 'maki:grocery', group: 'market', tier: 3 },
  { name: 'shop', source: 'maki:shop', group: 'shop', tier: 4 },
  { name: 'clothing', source: 'maki:clothing-store', group: 'shop', tier: 4 },
  { name: 'jewelry', source: 'maki:jewelry-store', group: 'shop', tier: 4 },
  { name: 'florist', source: 'maki:florist', group: 'shop', tier: 4 },
  { name: 'gift', source: 'maki:gift', group: 'shop', tier: 4 },
  { name: 'phone', source: 'maki:mobile-phone', group: 'shop', tier: 4 },
  { name: 'furniture', source: 'temaki:furniture', group: 'shop', tier: 4 },
  { name: 'hairdresser', source: 'maki:hairdresser', group: 'shop', tier: 4 },
  { name: 'beauty', source: 'temaki:beauty_salon', group: 'shop', tier: 4 },
  { name: 'spa', source: 'temaki:spa', group: 'shop', tier: 4 },
  { name: 'hospital', source: 'maki:hospital', group: 'health', tier: 1 },
  { name: 'doctor', source: 'maki:doctor', group: 'health', tier: 3 },
  { name: 'dentist', source: 'maki:dentist', group: 'health', tier: 3 },
  { name: 'pharmacy', source: 'maki:pharmacy', group: 'pharmacy', tier: 2 },
  { name: 'bank', source: 'maki:bank', group: 'money', tier: 3 },
  { name: 'atm', source: 'temaki:atm', group: 'money', tier: 4 },
  { name: 'fuel', source: 'maki:fuel', group: 'fuel', tier: 3 },
  { name: 'car-repair', source: 'maki:car-repair', group: 'fuel', tier: 4 },
  { name: 'car', source: 'maki:car', group: 'fuel', tier: 4 },
  { name: 'lodging', source: 'maki:lodging', group: 'lodging', tier: 3 },
  { name: 'school', source: 'maki:school', group: 'education', tier: 3 },
  { name: 'college', source: 'maki:college', group: 'education', tier: 2 },
  { name: 'library', source: 'maki:library', group: 'education', tier: 3 },
  { name: 'mosque', source: 'maki:religious-muslim', group: 'worship', tier: 2 },
  { name: 'church', source: 'maki:religious-christian', group: 'worship', tier: 2 },
  { name: 'synagogue', source: 'maki:religious-jewish', group: 'worship', tier: 2 },
  { name: 'worship', source: 'maki:place-of-worship', group: 'worship', tier: 2 },
  { name: 'park', source: 'maki:park', group: 'nature', tier: 3 },
  { name: 'garden', source: 'maki:garden', group: 'nature', tier: 3 },
  { name: 'gym', source: 'maki:fitness-centre', group: 'nature', tier: 4 },
  { name: 'stadium', source: 'maki:stadium', group: 'nature', tier: 3 },
  { name: 'museum', source: 'maki:museum', group: 'culture', tier: 3 },
  { name: 'theatre', source: 'maki:theatre', group: 'culture', tier: 3 },
  { name: 'cinema', source: 'maki:cinema', group: 'culture', tier: 3 },
  { name: 'art-gallery', source: 'maki:art-gallery', group: 'culture', tier: 3 },
  { name: 'monument', source: 'maki:monument', group: 'culture', tier: 3 },
  { name: 'post', source: 'maki:post', group: 'cargo', tier: 2 },
  { name: 'police', source: 'maki:police', group: 'safety', tier: 3 },
  { name: 'fire-station', source: 'maki:fire-station', group: 'safety', tier: 3 },
  { name: 'town-hall', source: 'maki:town-hall', group: 'public', tier: 3 },
  { name: 'bus', source: 'maki:bus', group: 'transit', tier: 4 },
  { name: 'metro', source: 'maki:rail-metro', group: 'transit', tier: 1 },
  { name: 'train', source: 'maki:rail', group: 'transit', tier: 1 },
  { name: 'ferry', source: 'maki:ferry', group: 'transit', tier: 1 },
  { name: 'airport', source: 'maki:airport', group: 'transit', tier: 1 },
  { name: 'parking', source: 'maki:parking', group: 'transit', tier: 4 },
];

export const LEGEND_GLYPH: Record<IconGroup | 'brands', string> = {
  health: 'hospital',
  pharmacy: 'pharmacy',
  safety: 'police',
  money: 'bank',
  fuel: 'fuel',
  worship: 'mosque',
  lodging: 'lodging',
  market: 'grocery',
  public: 'town-hall',
  food: 'restaurant',
  shop: 'shop',
  cargo: 'post',
  landmark: 'monument',
  nature: 'park',
  culture: 'museum',
  transit: 'bus',
  education: 'school',
  brands: 'grocery',
};

export const GLYPH_NAMES = GLYPH_TABLE.map((row) => row.name);
export const BADGE_ICONS = GLYPH_NAMES.map((name) => `geo-badge-${name}`);
export const NO_GLYPH = 'none';

export const RULES: readonly (readonly [string, readonly string[]])[] = [
  ['pharmacy', ['pharmacy', 'drugstore']],
  ['hospital', ['hospital', 'emergency_room', 'urgent_care']],
  ['dentist', ['dentist', 'dental', 'orthodontist']],
  ['atm', ['atm']],
  ['bank', ['bank', 'credit_union', 'currency_exchange', 'money_transfer']],
  ['mosque', ['mosque', 'muslim']],
  ['church', ['church', 'christian', 'cathedral', 'chapel']],
  ['synagogue', ['synagogue', 'jewish']],
  ['worship', ['place_of_worship', 'temple', 'hindu', 'buddhist', 'shrine']],
  ['fuel', ['gas_station', 'fuel', 'ev_charging', 'charging_station']],
  ['car-repair', ['car_wash', 'automotive_repair', 'auto_repair', 'car_repair', 'tire', 'tires', 'auto_parts', 'mechanic']],
  ['car', ['auto_dealer', 'car_dealer', 'car_rental', 'motorcycle_dealer']],
  ['parking', ['parking']],
  ['lodging', ['hotel', 'motel', 'hostel', 'guest_house', 'lodging', 'bed_and_breakfast', 'resort']],
  ['fast-food', ['fast_food', 'burger', 'pizza', 'kebab', 'doner', 'sandwich']],
  ['cafe', ['cafe', 'coffee', 'tea_room', 'tea_house', 'internet_cafe']],
  ['bakery', ['bakery', 'pastry', 'dessert', 'ice_cream', 'candy', 'chocolate', 'patisserie']],
  ['bar', ['bar', 'pub', 'nightclub', 'night_club', 'brewery', 'winery', 'lounge', 'cocktail']],
  ['grocery', ['grocery', 'supermarket', 'convenience_store', 'marketplace', 'bazaar', 'butcher', 'greengrocer', 'market', 'fruits_and_vegetables', 'organic_store']],
  ['restaurant', ['restaurant', 'food', 'eatery', 'cafeteria', 'steakhouse', 'diner', 'buffet', 'seafood', 'meyhane']],
  ['shop', ['shopping_mall', 'shopping_center', 'department_store', 'mall']],
  ['clothing', ['clothing', 'clothes', 'apparel', 'shoe', 'shoes', 'fashion', 'boutique', 'lingerie', 'bridal', 'uniform']],
  ['jewelry', ['jewelry', 'watch', 'watches']],
  ['florist', ['flowers', 'florist', 'flower']],
  ['gift', ['gift', 'toy', 'toys', 'souvenir', 'novelty']],
  ['phone', ['mobile_phone', 'phone', 'electronics', 'computer', 'appliance', 'appliances', 'camera', 'video_game']],
  ['furniture', ['furniture', 'home_goods', 'home_improvement', 'hardware', 'lighting', 'mattress', 'carpet', 'curtain', 'interior']],
  ['hairdresser', ['hair', 'barber', 'hairdresser', 'hair_salon', 'hair_removal']],
  ['beauty', ['beauty', 'nail', 'nails', 'cosmetic', 'cosmetics', 'makeup', 'tattoo', 'eyelash', 'salon']],
  ['spa', ['spa', 'massage', 'sauna', 'hammam', 'turkish_bath', 'day_spa', 'health_spa']],
  ['gym', ['gym', 'fitness', 'yoga', 'pilates', 'sports_club', 'crossfit', 'martial', 'boxing', 'swimming', 'recreation_center']],
  ['stadium', ['stadium', 'arena', 'sports_complex', 'sports_field', 'soccer', 'football', 'tennis', 'golf', 'racetrack', 'skating']],
  ['doctor', ['doctor', 'doctors', 'physician', 'clinic', 'medical', 'health', 'veterinarian']],
  ['school', ['school', 'kindergarten', 'preschool', 'nursery', 'daycare', 'tutoring', 'driving_school', 'language_school', 'education']],
  ['college', ['university', 'college']],
  ['library', ['library']],
  ['garden', ['garden', 'botanical']],
  ['park', ['park', 'playground', 'beach', 'forest', 'nature']],
  ['museum', ['museum', 'planetarium', 'science_center', 'aquarium', 'zoo']],
  ['theatre', ['theater', 'theatre', 'opera', 'concert', 'performing_arts', 'comedy', 'music_venue']],
  ['cinema', ['cinema', 'movie', 'movie_theater']],
  ['art-gallery', ['art_gallery', 'gallery', 'arts_and_entertainment', 'art_studio', 'art', 'arts', 'painting']],
  ['monument', ['historic_site', 'monument', 'castle', 'palace', 'landmark', 'historic', 'fortress', 'memorial', 'statue']],
  ['post', ['post_office', 'postal', 'courier', 'shipping', 'mailing', 'freight_and_cargo', 'delivery', 'cargo']],
  ['police', ['police', 'law_enforcement', 'sheriff']],
  ['fire-station', ['fire_station', 'fire_department']],
  ['town-hall', ['government', 'town_hall', 'city_hall', 'courthouse', 'municipal', 'embassy', 'consulate', 'public_service', 'tax', 'notary']],
  ['bus', ['bus_station', 'bus_stop', 'bus', 'minibus', 'dolmus']],
  ['metro', ['subway', 'metro', 'tram', 'light_rail', 'funicular', 'cable_car']],
  ['train', ['train_station', 'railway', 'rail', 'train']],
  ['ferry', ['ferry', 'pier', 'port', 'marina', 'harbor', 'boat']],
  ['airport', ['airport', 'heliport', 'airfield']],
];

const FALLBACK: Record<string, string> = {
  pharmacy: 'pharmacy',
  health: 'doctor',
  safety: 'police',
  cargo: 'post',
  money: 'bank',
  fuel: 'fuel',
  worship: 'worship',
  lodging: 'lodging',
  market: 'grocery',
  food: 'restaurant',
  public: 'town-hall',
  shop: 'shop',
};

function ruleGlyph(category: string | null | undefined): string | null {
  const padded = `_${category ?? ''}_`;
  for (const [glyph, keys] of RULES) if (keys.some((key) => padded.includes(`_${key}_`))) return glyph;
  return null;
}

export function glyphOf(category: string | null | undefined, dataGroup?: string | null): string | null {
  return ruleGlyph(category) ?? (dataGroup ? FALLBACK[dataGroup] : undefined) ?? null;
}

export const KIND_GLYPH: Record<string, string> = {
  hospital: 'hospital',
  clinic: 'doctor',
  doctors: 'doctor',
  medical: 'doctor',
  medical_supply: 'doctor',
  dentist: 'dentist',
  pharmacy: 'pharmacy',
  police: 'police',
  fire_station: 'fire-station',
  courthouse: 'town-hall',
  prison: 'town-hall',
  townhall: 'town-hall',
  public_building: 'town-hall',
  community_centre: 'town-hall',
  bank: 'bank',
  atm: 'atm',
  money_transfer: 'bank',
  bureau_de_change: 'bank',
  fuel: 'fuel',
  car_wash: 'car-repair',
  car_repair: 'car-repair',
  place_of_worship: 'worship',
  religious: 'worship',
  hotel: 'lodging',
  motel: 'lodging',
  hostel: 'lodging',
  guest_house: 'lodging',
  marketplace: 'grocery',
  mall: 'shop',
  department_store: 'shop',
  kindergarten: 'school',
  school: 'school',
  college: 'college',
  university: 'college',
  library: 'library',
  public_bath: 'spa',
  turkish_bath: 'spa',
  park: 'park',
  beach: 'park',
  forest: 'park',
  garden: 'garden',
  stadium: 'stadium',
  zoo: 'museum',
  museum: 'museum',
  theatre: 'theatre',
  attraction: 'monument',
  artwork: 'art-gallery',
  post_office: 'post',
  bus_station: 'bus',
  bus_stop: 'bus',
  station: 'train',
  ferry_terminal: 'ferry',
  marina: 'ferry',
  aerodrome: 'airport',
};

export const KIND_NAMES = Object.keys(KIND_GLYPH);

const padded = (): unknown[] => ['concat', '_', ['coalesce', ['get', 'cat'], ''], '_'];

const placeGlyph = (): unknown[] => {
  const cases = RULES.flatMap(([glyph, keys]) => [['any', ...keys.map((key) => ['in', `_${key}_`, ['var', 'h']])], glyph]);
  return ['let', 'h', padded(), ['case', ...cases, ['match', ['get', 'g'], ...Object.entries(FALLBACK).flat(), NO_GLYPH]]];
};

const kindGlyph = (): unknown[] => ['match', ['get', 'kind'], ...Object.entries(KIND_GLYPH).flat(), NO_GLYPH];

const byGlyph = (values: (row: GlyphRow) => string | number, fallback: string | number): unknown[] => ['match', ['var', 'k'], ...GLYPH_TABLE.flatMap((row) => [row.name, values(row)]), fallback];

export const withGlyph = (source: unknown[], body: unknown[]): unknown[] => ['let', 'k', source, ['let', 't', byGlyph((row) => row.tier, 0), ['let', 'grp', byGlyph((row) => row.group, 'public'), body]]];

const NAME_ENDINGS: Record<string, string> = {
  cami: 'mosque',
  camii: 'mosque',
  camisi: 'mosque',
  mescit: 'mosque',
  mescidi: 'mosque',
  eczane: 'pharmacy',
  eczanesi: 'pharmacy',
  hastane: 'hospital',
  hastanesi: 'hospital',
};

const FOLD_NAME: Record<string, string> = { İ: 'i', I: 'ı', Ç: 'ç', Ğ: 'ğ', Ö: 'ö', Ş: 'ş', Ü: 'ü' };

export function glyphFromName(name: string | null | undefined): string | null {
  const last = (name ?? '').trim().split(/\s+/).pop() ?? '';
  const folded = [...last].map((char) => FOLD_NAME[char] ?? char.toLowerCase()).join('').replace(/[^a-zçğıöşü]/g, '');
  return NAME_ENDINGS[folded.replace(/ı/g, 'i')] ?? null;
}

export type PlaceProps = { k: string; t: number; grp: IconGroup };

const ROW_OF = new Map<string, (typeof GLYPH_TABLE)[number]>(GLYPH_TABLE.map((row) => [row.name, row]));

export function placeProps(category: string | null | undefined, dataGroup?: string | null, name?: string | null): PlaceProps {
  const byRule = ruleGlyph(category);
  const k = (byRule === null || ROW_OF.get(byRule)?.group === 'shop' ? glyphFromName(name) : null) ?? glyphOf(category, dataGroup) ?? NO_GLYPH;
  const row = ROW_OF.get(k);
  return { k, t: row?.tier ?? 0, grp: (row?.group ?? 'public') as IconGroup };
}

const baked = (name: string, fallback: unknown[]): unknown[] => ['coalesce', ['get', name], fallback];

export const withPlace = (body: unknown[]): unknown[] => ['let', 'k', baked('k', placeGlyph()), ['let', 't', baked('t', byGlyph((row) => row.tier, 0)), ['let', 'grp', baked('grp', byGlyph((row) => row.group, 'public')), body]]];
export const withKind = (body: unknown[]): unknown[] => withGlyph(kindGlyph(), body);

export const glyphExpression = (): unknown[] => withPlace(['var', 'k']);
export const groupExpression = (): unknown[] => withPlace(['var', 'grp']);
export const tierExpression = (): unknown[] => withPlace(['var', 't']);
