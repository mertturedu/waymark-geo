const { withPlugins } = require('expo/config-plugins');

const MAPLIBRE = '@maplibre/maplibre-react-native';

const nameOf = (entry) => (Array.isArray(entry) ? entry[0] : entry);

module.exports = function withGeo(config) {
  const listed = (config.plugins || []).some((entry) => nameOf(entry) === MAPLIBRE);
  return listed ? config : withPlugins(config, [MAPLIBRE]);
};
