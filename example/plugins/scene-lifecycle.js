const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const SCENES = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' }],
  },
};

const START = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

function adoptScenes(source) {
  let out = source;
  if (!out.includes('ExpoReactNativeFactoryProvider')) {
    if (!out.includes('class AppDelegate: ExpoAppDelegate {')) throw new Error('scene-lifecycle: AppDelegate sınıfı beklenen biçimde değil');
    out = out.replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
  }
  if (START.test(out)) out = out.replace(START, '\n');
  else if (out.includes('factory.startReactNative(')) throw new Error('scene-lifecycle: React Native başlatma bloğu bulunamadı');
  return out;
}

const withScenes = (config) =>
  withAppDelegate(
    withInfoPlist(config, (mod) => {
      mod.modResults.UIApplicationSceneManifest = SCENES;
      return mod;
    }),
    (mod) => {
      if (mod.modResults.language !== 'swift') throw new Error('scene-lifecycle: yalnızca Swift AppDelegate desteklenir');
      mod.modResults.contents = adoptScenes(mod.modResults.contents);
      return mod;
    },
  );

module.exports = withScenes;
module.exports.adoptScenes = adoptScenes;
module.exports.SCENES = SCENES;
