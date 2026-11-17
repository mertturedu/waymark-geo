import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const plugin = require('../../example/plugins/scene-lifecycle.js') as { adoptScenes(source: string): string; SCENES: { UISceneConfigurations: { UIWindowSceneSessionRoleApplication: { UISceneDelegateClassName: string }[] } } };

const TEMPLATE = `@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let factory = ExpoReactNativeFactory(delegate: delegate)
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

describe('scene life cycle plugin', () => {
  it('lets the Expo scene delegate start React Native', () => {
    const out = plugin.adoptScenes(TEMPLATE);
    expect(out).toContain('class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    expect(out).not.toContain('startReactNative');
    expect(out).not.toContain('UIScreen.main.bounds');
    expect(out).toContain('reactNativeFactory = factory');
    expect(out).toContain('return super.application(application, didFinishLaunchingWithOptions: launchOptions)');
  });

  it('is safe to run twice', () => {
    const once = plugin.adoptScenes(TEMPLATE);
    expect(plugin.adoptScenes(once)).toBe(once);
  });

  it('stops the build when the app delegate looks different', () => {
    expect(() => plugin.adoptScenes('class Other {}')).toThrow(/AppDelegate/);
    expect(() => plugin.adoptScenes(TEMPLATE.replace('#if os(iOS) || os(tvOS)\n', ''))).toThrow(/başlatma/);
  });

  it('names the Expo scene delegate in the scene manifest', () => {
    expect(plugin.SCENES.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0]!.UISceneDelegateClassName).toBe('EXExpoAppSceneDelegate');
  });

  const generated = new URL('../../example/ios/GeoOrnek/AppDelegate.swift', import.meta.url);
  (existsSync(generated) ? it : it.skip)('matches the app delegate that prebuild writes today', () => {
    const current = readFileSync(generated, 'utf8');
    expect(plugin.adoptScenes(current)).not.toContain('startReactNative');
  });
});
