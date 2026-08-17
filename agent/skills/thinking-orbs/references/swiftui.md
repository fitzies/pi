# SwiftUI integration

Use this guide for native SwiftUI applications targeting iOS 15+ or macOS 12+.

## Distribution status

The official SwiftUI implementation is `ThinkingOrbsKit` in the upstream `Jakubantalik/Libraries` monorepo. The public demo currently suggests this remote dependency:

```swift
.package(url: "https://github.com/Jakubantalik/Libraries.git/", from: "0.3.1")
```

Do **not** use that declaration without rechecking upstream. At the 2026-08-18 snapshot it cannot resolve: the repository has no compatible `0.3.1` tag and no root `Package.swift`.

This skill bundles a tested local package snapshot at:

```text
assets/swift/ThinkingOrbsKit/
```

It contains the upstream Swift sources, a minimal local `Package.swift`, and the upstream MIT license. The upstream full package passed its golden-vector tests before the snapshot was bundled.

## Install as a local package

1. Copy the complete bundled `ThinkingOrbsKit` directory into the target repository, conventionally at:

   ```text
   Packages/ThinkingOrbsKit/
   ```

2. Keep `Packages/ThinkingOrbsKit/LICENSE` intact.
3. Add it as a **local** package dependency:
   - In Xcode, use **File → Add Package Dependencies → Add Local…** and choose the copied directory.
   - In Tuist, XcodeGen, or another project generator, declare the local package using that tool's normal syntax.
   - In a parent Swift package, add a path dependency and product dependency:

```swift
// package.dependencies
.package(path: "Packages/ThinkingOrbsKit")

// target.dependencies
.product(name: "ThinkingOrbsKit", package: "ThinkingOrbsKit")
```

Adapt the relative path to the location of the parent `Package.swift`.

Do not copy individual Swift files into the app target unless the project cannot use local packages. Keeping the implementation packaged avoids name collisions and preserves attribution.

## Usage

```swift
import ThinkingOrbsKit

struct AgentStatus: View {
    let isSearching: Bool

    var body: some View {
        if isSearching {
            HStack(spacing: 8) {
                ThinkingOrb(state: .searching, size: .px20)
                    .accessibilityHidden(true)
                Text("Searching project files…")
            }
        }
    }
}
```

A prominent avatar-scale example:

```swift
ThinkingOrb(
    state: .composing,
    size: .px64,
    theme: .auto,
    speed: 1,
    paused: false
)
.accessibilityLabel("Drafting your summary…")
```

## API

```swift
ThinkingOrb(
    state: OrbState = .working,
    size: OrbSize = .px64,
    theme: OrbTheme = .auto,
    speed: Double = 1,
    paused: Bool = false,
    displaySize: Double? = nil
)
```

### States

```swift
.working
.searching
.solving
.listening
.connecting
.weaving
.composing
.breathing
.shaping
```

### Sizes

- `.px20` — tuned inline design.
- `.px64` — tuned chat-avatar design.
- `displaySize` — optional rendered point size while retaining the selected preset's vector geometry.

For a large display, prefer `size: .px64, displaySize: 100` rather than enlarging the sparse 20-point design.

## Theme

- `.auto` follows SwiftUI's `colorScheme` environment.
- `.dark` renders light ink for a dark surface.
- `.light` renders dark ink for a light surface.

If a local surface intentionally differs from the surrounding environment, pass its actual theme explicitly.

## Accessibility and motion

The component:

- exposes itself as an image,
- supplies a label based on the state,
- follows `accessibilityReduceMotion`,
- renders a deterministic static frame for reduced motion or `paused`,
- and uses `TimelineView(.animation)` plus SwiftUI `Canvas` for normal motion.

Override the label with SwiftUI's `.accessibilityLabel(...)` when task-specific copy is clearer. The inline example has one announcement owner: the visible `Text`; the orb is hidden from VoiceOver. If there is no adjacent accessible status, leave the orb exposed and give it the task-specific label.

SwiftUI may throttle or stop timeline updates for views it no longer renders, but this is not a guaranteed visibility API. If a list or hidden container retains many orbs, drive `paused` from the app's own lifecycle or visibility state.

## Lifecycle example

Drive the orb from a real enum rather than unrelated booleans:

```swift
enum AgentPhase {
    case idle
    case connecting
    case searching
    case composing
    case complete
    case failed
}
```

Map only running phases to an `OrbState`; show result/error UI for terminal phases. Do not leave a paused orb as the only indication that work completed.

## Verification

After integration:

1. Confirm the app deployment target is iOS 15+ or macOS 12+.
2. Resolve the local package product and build the app.
3. Test at least one 20-point and one 64-point use.
4. Toggle light/dark environment values.
5. Enable Reduce Motion and confirm a static visible frame remains.
6. Verify VoiceOver announces a useful status without duplication.
7. Test state transitions and removal on completion, failure, cancellation, and input-required phases.

The bundled local package itself can be checked with:

```bash
swift build --package-path Packages/ThinkingOrbsKit
```

Use the project's normal Xcode build/test command as the final integration check.
