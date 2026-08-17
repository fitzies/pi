# Sources, versions, and distribution status

Snapshot date: **2026-08-18**

## Official sources

- Original repository supplied by the user: [Jakubantalik/thinking-orbs](https://github.com/Jakubantalik/thinking-orbs)
  - Inspected main commit: `de85557ca220332586d070d8788c0e1d6e877a0d`
- Current monorepo linked by the live demo for native ports: [Jakubantalik/Libraries](https://github.com/Jakubantalik/Libraries/tree/main/packages/thinking-orbs)
  - Bundled native-source commit: `cdbcf43cdcc1703efd7a4c14e217e7ec5c551b7a`
- Official live demo and installation tabs: [orbs.jakubantalik.com](https://orbs.jakubantalik.com/)
- Published React package: [thinking-orbs on npm](https://www.npmjs.com/package/thinking-orbs)
- SwiftUI source: [ThinkingOrbsKit](https://github.com/Jakubantalik/Libraries/tree/main/packages/thinking-orbs/ports/ios/ThinkingOrbsKit)
- React Native source: [thinking-orbs-native](https://github.com/Jakubantalik/Libraries/tree/main/packages/thinking-orbs/ports/react-native/thinking-orbs-native)
- Upstream license: [MIT](https://github.com/Jakubantalik/Libraries/blob/main/packages/thinking-orbs/LICENSE)

The live demo credits Jakub Antalik and Alex Brinza. The repository license is MIT, copyright © 2026 Jakub Antalik.

## Platform status at snapshot

### React web

- npm package: `thinking-orbs`
- published version: `0.3.1`
- React peer: `>=18`
- browser implementation: plain 2D canvas
- documented browsers: Chrome, Safari, Firefox
- stable public installation path

### SwiftUI

- library/product: `ThinkingOrbsKit`
- Swift tools: 5.9 in upstream package manifest
- platforms: iOS 15+, macOS 12+
- dependencies: none
- renderer: SwiftUI `TimelineView(.animation)` + `Canvas`
- source is present and tested in the `Libraries` monorepo
- bundled snapshot includes the upstream source and a minimal local package manifest

The live site's suggested remote dependency was tested and failed on the snapshot date:

```swift
.package(url: "https://github.com/Jakubantalik/Libraries.git/", from: "0.3.1")
```

Reasons:

1. The monorepo has no compatible `0.3.1` version tag.
2. The repository root has no `Package.swift`; the package manifest is nested.

The skill therefore uses a tested local package rather than promising a broken remote resolution path. Recheck upstream before changing this policy.

### React Native

- intended package name: `thinking-orbs-native`
- source version: `0.1.0`
- npm registry status: unpublished / 404 at snapshot
- React: `>=18`
- React Native: `>=0.72`
- Shopify Skia: `>=1`
- Reanimated: `>=3`
- dependency: `thinking-orbs ^0.3.1`
- upstream runtime status: iOS simulator verified; physical device and Android unverified

The skill vendors source into the target app rather than creating a fake package-registry dependency.

## Bundled assets

### SwiftUI

Location:

```text
assets/swift/ThinkingOrbsKit/
```

Contents:

- upstream `Sources/ThinkingOrbsKit/*.swift` from monorepo commit `cdbcf43…`
- a local correction that freezes reduced-motion/paused output at raw engine time `0.6`, matching web and React Native, plus a comment clarifying that offscreen timeline suspension is not guaranteed
- a minimal local `Package.swift` preserving upstream platform requirements
- upstream `LICENSE`

Verification performed before bundling:

- upstream package built successfully,
- golden-vector test passed: 72 cases / 70,115 values within `1e-4`,
- performance test passed,
- snapshot-writing test skipped as designed unless an output directory is supplied,
- the patched bundled local package built successfully after the reduced-motion correction.

### React Native

Location:

```text
assets/react-native/thinking-orbs-native/
```

Contents:

- upstream `src/index.ts`
- upstream `src/theme.ts`
- upstream `src/ThinkingOrb.tsx`
- upstream `src/types.ts`
- a local `accessible?: boolean` integration patch so adjacent status text can be the sole VoiceOver/TalkBack announcement owner
- upstream `LICENSE`

Verification performed before bundling:

- dependencies installed in an isolated temporary checkout,
- upstream `tsc --noEmit` completed successfully,
- the locally patched bundled source also passed `tsc --noEmit`.

This does not replace a native runtime build. The platform guide requires a real target build after integration.

## Drift policy

Use local references by default. Check live sources when:

- the user asks for the latest version,
- a dependency already uses a newer version,
- upstream may have published React Native,
- upstream may have fixed remote SwiftPM distribution,
- or platform requirements conflict with the local project.

When refreshing:

1. Record the exact upstream commit.
2. Compare public API, defaults, labels, themes, and reduced-motion behavior.
3. Preserve the MIT notice.
4. Re-run Swift golden tests and React Native type checks.
5. Run real target builds for any platform whose integration changes.
6. Update this file's status and snapshot date.

Do not silently replace verified local assets with untested live source.
