const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [
  path.resolve(__dirname, '../src'),
  path.resolve(__dirname, '../scripts/spikes'),
  path.resolve(__dirname, '../fixtures'),
  path.resolve(__dirname, '../test/text/helpers'),
];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];

module.exports = config;
