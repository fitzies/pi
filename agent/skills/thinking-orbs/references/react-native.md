# React Native and Expo integration

Use this guide for React Native 0.72+ and Expo applications.

## Distribution status

The official React Native port is beta. As of the 2026-08-18 snapshot:

- `thinking-orbs-native` is **not published on npm**.
- Upstream has run it on an iOS simulator using Expo SDK 53 / React Native 0.79.6 / Skia 2.0.0-next.4.
- A physical device and Android remain unverified upstream.
- The renderer shares the official `thinking-orbs/engine` geometry and draws through Shopify Skia.

Do not run `npm install thinking-orbs-native`; it currently returns 404. Do not silently substitute the third-party `expo-thinking-orbs` package.

This skill bundles the upstream component source at:

```text
assets/react-native/thinking-orbs-native/
```

## Recommended integration: vendor into app source

Copy the complete bundled directory into the target application, for example:

```text
src/vendor/thinking-orbs-native/
├── LICENSE
└── src/
    ├── index.ts
    ├── theme.ts
    ├── ThinkingOrb.tsx
    └── types.ts
```

Keep the included `LICENSE`. Import through the vendored index using the project's configured relative path or path alias:

```tsx
import { ThinkingOrb } from '@/vendor/thinking-orbs-native/src';
```

Adapt the alias to the actual project. Keeping source inside the app lets Metro compile it directly and avoids pretending an unpublished npm package exists.

## Dependencies

The vendored component requires:

- `thinking-orbs` `^0.3.1` for the shared React-free geometry engine,
- `@shopify/react-native-skia` `>=1`,
- `react-native-reanimated` `>=3`,
- React `>=18`,
- React Native `>=0.72`.

For Expo, use Expo's compatibility resolver for native dependencies:

```bash
npm install thinking-orbs
npx expo install @shopify/react-native-skia react-native-reanimated
```

For a bare React Native app, use the existing package manager and versions compatible with the app:

```bash
npm install thinking-orbs @shopify/react-native-skia react-native-reanimated
```

Then complete the official Skia/Reanimated setup for the exact installed versions and run CocoaPods where the project requires it. Do not blindly add an outdated Babel plugin snippet: Reanimated setup differs by major version and Expo SDK.

## Usage

```tsx
import { View, Text } from 'react-native';
import { ThinkingOrb } from '@/vendor/thinking-orbs-native/src';

export function AgentStatus() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <ThinkingOrb
        state="searching"
        size={20}
        accessible={false}
      />
      <Text accessibilityLiveRegion="polite">Searching project files…</Text>
    </View>
  );
}
```

The example has one announcement owner: the visible status text. The bundled component's `accessible={false}` integration patch hides the orb and its Skia descendants from VoiceOver/TalkBack. If there is no adjacent accessible status, omit that prop and supply `accessibilityLabel` on the orb.

## Props

```ts
type ThinkingOrbProps = {
  state?:
    | 'working'
    | 'searching'
    | 'solving'
    | 'listening'
    | 'connecting'
    | 'weaving'
    | 'composing'
    | 'breathing'
    | 'shaping';
  size?: 64 | 20;
  theme?: 'auto' | 'dark' | 'light';
  speed?: number;
  paused?: boolean;
  displaySize?: number;
  accessible?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
};
```

Defaults are `working`, `64`, `auto`, speed `1`, not paused, and accessible as an image.

`displaySize` changes the Skia canvas dimensions while retaining the selected 20 or 64 preset geometry. This stays vector-crisp and is preferable to scaling the already-rendered view.

## Platform-specific behavior

### Theme

`theme="auto"` follows React Native's `useColorScheme()`—the OS appearance. Unlike the React web component, there is no DOM ancestor theme detection. If the app has an in-app theme independent of the OS, pass `dark` or `light` explicitly from that theme context.

### Reduced motion

The component listens to `AccessibilityInfo.isReduceMotionEnabled()` and `reduceMotionChanged`. Reduced-motion users receive a static representative frame.

### App and viewport visibility

The render loop stops while `AppState` is backgrounded. React Native has no equivalent built into this component for the web implementation's `IntersectionObserver`. If many orbs can appear in a virtualized list, drive `paused` from viewability state and animate only active visible work.

### Rendering

Geometry is generated on the JavaScript thread from `thinking-orbs/engine`; Skia rasterizes on the UI thread. Do not attempt to add worklet directives throughout the shared engine. Upstream measured the geometry as cheap enough that this complexity was unnecessary.

## Expo considerations

- Prefer `npx expo install` for Skia and Reanimated to match the current SDK.
- Confirm whether the selected SDK/runtime supports the required native modules in Expo Go; use a development build when required.
- Clear Metro cache only when dependency or transform configuration changes, not as a default ritual.
- Verify on the actual target runtime, not only web preview.

## Verification

1. Run the project's dependency install and TypeScript check.
2. Confirm Metro resolves `thinking-orbs/engine` and the vendored source.
3. Build and launch the native target; typechecking alone is insufficient.
4. Exercise all states used by the app at both 20 and 64 where applicable.
5. Test explicit and automatic themes.
6. Enable Reduce Motion and confirm a static frame.
7. Background/foreground the app and confirm the orb resumes correctly.
8. Verify screen-reader labeling and state updates.
9. Test removal or replacement on success, failure, cancellation, and input-required phases.
10. If shipping Android or physical-device builds, explicitly test them and report results because upstream validation did not cover them at the snapshot date.

## Updating the vendored snapshot

When upstream changes:

1. Compare the official `thinking-orbs-native/src` directory against the bundled snapshot.
2. Verify compatible `thinking-orbs`, Skia, Reanimated, React, and RN versions.
3. Preserve the MIT notice.
4. Run upstream type checks, then real target builds.
5. Update [SOURCES.md](./SOURCES.md) with the new commit and validation status.
