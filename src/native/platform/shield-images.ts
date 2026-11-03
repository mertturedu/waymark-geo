/// <reference path="./assets.d.ts" />
import motorway from '../map/icons/geo-shield-motorway.png';
import euro from '../map/icons/geo-shield-euro.png';
import state from '../map/icons/geo-shield-state.png';
import provincial from '../map/icons/geo-shield-provincial.png';

export const SHIELD_ICON_IMAGES: Record<string, number> = {
  'geo-shield-motorway': motorway as number,
  'geo-shield-euro': euro as number,
  'geo-shield-state': state as number,
  'geo-shield-provincial': provincial as number,
};
