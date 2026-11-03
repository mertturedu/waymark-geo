module.exports = {
  expo: {
    name: 'Geo Ornek',
    slug: 'geo-example',
    scheme: 'geoornek',
    version: '0.0.0',
    orientation: 'default',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      bundleIdentifier: 'com.aakgur.yuksigeoexample',
      appleTeamId: 'MW2482B7WH',
      supportsTablet: false,
      infoPlist: {
        NSAppTransportSecurity: { NSAllowsLocalNetworking: true, NSAllowsArbitraryLoads: true },
        NSLocalNetworkUsageDescription: 'Yerel paket sunucusuna baglanmak icin gerekli.',
      },
    },
    android: {
      package: 'com.aakgur.yuksigeoexample',
    },
    plugins: [
      '@maplibre/maplibre-react-native',
      './plugins/large-heap',
      './plugins/scene-lifecycle',
      ['expo-build-properties', { android: { usesCleartextTraffic: true } }],
      ['expo-location', { locationWhenInUsePermission: 'Yakınındaki harita paketini önermek için konumun kullanılır.' }],
    ],
  },
};
