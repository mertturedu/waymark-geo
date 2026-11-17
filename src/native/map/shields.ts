export type ShieldKind = 'motorway' | 'euro' | 'state' | 'provincial';

export const SHIELD_IMAGES: Record<ShieldKind, string> = {
  motorway: 'geo-shield-motorway',
  euro: 'geo-shield-euro',
  state: 'geo-shield-state',
  provincial: 'geo-shield-provincial',
};

export const SHIELD_MAX_LENGTH = 7;

export function shieldOf(ref: string): { kind: ShieldKind; text: string } | null {
  const text = ref.trim().replace(/\s+/g, ' ');
  if (text === '' || [...text].length > SHIELD_MAX_LENGTH) return null;
  const letter = /^([ODE])[\s.-]?(\d{1,3})$/i.exec(text);
  if (letter) {
    const prefix = (letter[1] as string).toUpperCase();
    const number = letter[2] as string;
    if (prefix === 'O') return { kind: 'motorway', text: `O-${number}` };
    if (prefix === 'E') return { kind: 'euro', text: `E${number}` };
    return { kind: 'state', text: `D${number}` };
  }
  if (/^\d{2}-\d{1,3}$/.test(text)) return { kind: 'provincial', text };
  return null;
}

export const shieldImageExpression = (): unknown[] => [
  'case',
  ['==', ['downcase', ['slice', ['get', 'ref'], 0, 1]], 'o'], SHIELD_IMAGES.motorway,
  ['==', ['downcase', ['slice', ['get', 'ref'], 0, 1]], 'e'], SHIELD_IMAGES.euro,
  ['==', ['downcase', ['slice', ['get', 'ref'], 0, 1]], 'd'], SHIELD_IMAGES.state,
  SHIELD_IMAGES.provincial,
];
