---
name: thinking-orbs
description: Add or review Thinking Orbs—animated dotted status indicators for AI and agent interfaces—in React web, SwiftUI, or React Native/Expo. Use when implementing an AI loader, thinking indicator, agent status orb, searching/solving/listening/connecting/composing animation, inline 20px activity mark, or 64px chat-avatar status. Selects the truthful state, installs the correct platform implementation, handles theme and reduced motion, and preserves upstream attribution.
---

# Thinking Orbs

Implement the official [Thinking Orbs](https://orbs.jakubantalik.com/) status indicator across React web, SwiftUI, and React Native. Nine animation states and two separately tuned size presets communicate what an AI agent is actually doing.

Use the official React package where it is stable. For SwiftUI and React Native, use the bundled, verified upstream-derived snapshots because current distribution differs by platform. Do not recreate the animation approximately with CSS, SVG, Core Animation, or a different particle system.

## Workflow

1. Detect the target platform from the project before changing dependencies or files.
2. Read [states and UX](./references/states-and-ux.md), then select the state that truthfully matches the operation.
3. Read exactly one platform guide:
   - [React web](./references/react.md)
   - [SwiftUI](./references/swiftui.md)
   - [React Native / Expo](./references/react-native.md)
4. Inspect the project's package manager, deployment targets, theme source, loading/status component, and accessibility conventions.
5. Surface a short proposal naming the state, size, placement, and platform integration. If the user already specified these, proceed.
6. Install or copy only the implementation for that platform. Preserve the upstream MIT license whenever vendored source is copied.
7. Wire the orb to real application state. Do not cycle through attractive animations on a timer unless the underlying operation truly changes.
8. Add or retain a concise textual status. The orb conveys category and activity, not precise progress or a complete explanation.
9. Verify normal motion, reduced motion, light/dark appearance, state changes, and the platform's build/type checks.

## Platform routing

| Project | Integration | Maturity |
| --- | --- | --- |
| React DOM, Next.js client component, Vite React | Published `thinking-orbs` npm package | Stable public package |
| SwiftUI on iOS 15+ or macOS 12+ | Bundled local `ThinkingOrbsKit` Swift package | Upstream geometry tests and patched local package build verified |
| React Native 0.72+ or Expo | Bundled upstream-derived component source plus Skia/Reanimated | Beta; local typecheck and upstream iOS simulator verified, not physical device or Android |

Do not install `thinking-orbs-native` from npm: it is not published as of the source snapshot. Do not use the website's remote Swift Package Manager declaration without rechecking it: the published monorepo URL currently has neither a root `Package.swift` nor a compatible `0.3.1` tag. The bundled local Swift package avoids that broken distribution path.

## State selection

| Actual activity | State |
| --- | --- |
| Generic execution or mixed work | `working` |
| Searching, retrieval, scanning, or lookup | `searching` |
| Reasoning through a bounded problem or resolving constraints | `solving` |
| Listening to voice/audio or waiting on spoken input | `listening` |
| Establishing a service, network, device, or data connection | `connecting` |
| Combining multiple sources or parallel strands | `weaving` |
| Drafting or generating text/content | `composing` |
| Calm indeterminate thinking or a low-intensity wait | `breathing` |
| Structuring, transforming, or forming an artifact | `shaping` |

If no state is clearly true, use `working`. Never use `searching` merely because its animation looks appropriate.

## Size selection

- Use the **20** preset inline with compact status text, toolbar content, or a dense task row.
- Use the **64** preset for a chat-avatar slot, prominent agent status, or larger standalone indicator.
- These are separate tuned designs, not one animation scaled down. Do not substitute arbitrary values for the `size` preset.
- SwiftUI and React Native expose `displaySize` for rendering a chosen preset at another visual size while retaining vector geometry. Prefer the 64 preset when enlarging substantially.
- React web `0.3.1` does not expose `displaySize`; size surrounding layout around 20 or 64 rather than stretching the canvas.

## Non-negotiable behavior

- Keep the canvas/background transparent and let the host surface provide its color.
- `theme="dark"` means light ink for a dark background; `theme="light"` means dark ink for a light background.
- Prefer automatic theme only when the platform's automatic source matches the app's actual theme. Pass an explicit theme when it does not.
- Preserve built-in reduced-motion behavior: a static representative frame replaces animation.
- Use the built-in accessible image label or provide a more specific one. Ensure adjacent live status text does not create confusing duplicate announcements.
- Do not represent determinate progress with an orb. Use a progress bar or numeric progress when completion can be measured.
- Do not leave an orb running after completion, failure, cancellation, or when user input is required.
- Do not add a second continuous pulse, spin, blur, or shimmer around the orb. Its internal motion is already the focal signal.

## Integration with other skills

- Use `beautiful-ui-patterns` to decide whether the surrounding surface should be a Loading State, Thinking disclosure, Tool Chips, or Task Rows.
- Use `frontend-design` for placement, hierarchy, typography, and visual fit.
- Do not use `transitions-dev` to alter the orb's internal animation. It may be used sparingly for the surrounding status container entering or leaving.

## Validation

### Every platform

- The selected state matches observable system activity.
- The 20 and 64 presets are not treated as arbitrary dimensions.
- Light ink is visible on dark surfaces and dark ink on light surfaces.
- Reduced motion produces a static frame.
- Completion/failure/input-required states replace or stop the running orb.
- A useful status is available to assistive technology.

### React web

- Run the project's package install, typecheck, tests, and build.
- Check SSR/hydration in frameworks that render on the server.
- Confirm ancestor `data-theme` or `.dark`/`.light` detection matches the app.

### SwiftUI

- Build the app or run `swift build` for package-based projects.
- Verify the minimum target is iOS 15+ or macOS 12+.
- Test light/dark environments and Reduce Motion.

### React Native

- Run typecheck plus an actual iOS or Android build; TypeScript success alone is insufficient.
- Verify Skia and Reanimated setup for the project's exact Expo/RN version.
- Test background/foreground behavior and Reduce Motion.
- If shipping Android or a physical-device build, explicitly report that upstream validation did not cover that target and test it locally.

## Sources and licensing

See [sources and version status](./references/SOURCES.md) and the [upstream MIT license](./references/UPSTREAM-LICENSE.md). Bundled SwiftUI and React Native assets are upstream-derived snapshots under that license. Keep their included `LICENSE` files when copying them into a project.
