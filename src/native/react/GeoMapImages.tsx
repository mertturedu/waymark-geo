import { Images } from '@maplibre/maplibre-react-native';
import { MAP_ICON_IMAGES } from '../platform/icon-images';

export function GeoMapImages() {
  return <Images images={MAP_ICON_IMAGES as never} />;
}
