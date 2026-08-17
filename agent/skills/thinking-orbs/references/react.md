# React web integration

Use this guide for React DOM applications, including Vite, Remix, and Next.js client components.

## Package

Official npm package: [`thinking-orbs`](https://www.npmjs.com/package/thinking-orbs)

Snapshot version: `0.3.1`  
Peer requirement: React `>=18`

Install with the project's existing package manager. Examples:

```bash
npm install thinking-orbs
# pnpm add thinking-orbs
# yarn add thinking-orbs
# bun add thinking-orbs
```

For reproducible applications, follow the project's lockfile/version policy. Do not install the React Native package in a DOM project.

## Basic usage

```tsx
import { ThinkingOrb } from 'thinking-orbs';

export function AgentStatus() {
  return (
    <div role="status" aria-live="polite">
      <ThinkingOrb
        state="searching"
        size={20}
        aria-hidden="true"
      />
      <span>Searching project files…</span>
    </div>
  );
}
```

The example has one announcement owner: the live text. The orb is decorative to assistive technology via `aria-hidden="true"`. If no adjacent accessible status exists, omit `aria-hidden` and give the orb a task-specific `aria-label` instead.

## Next.js and other server-rendered frameworks

The component paints a 2D canvas on the client and uses React effects. In a Next.js App Router project, place it behind a small local client boundary rather than importing it directly into a Server Component:

```tsx
'use client';

export { ThinkingOrb } from 'thinking-orbs';
```

Import that wrapper from server-rendered layouts/pages. Keep a stable square slot so the client-painted canvas does not cause layout shift. Do not disable SSR for a larger route solely because of this component.

## Props

```ts
type OrbState =
  | 'working'
  | 'searching'
  | 'solving'
  | 'listening'
  | 'connecting'
  | 'weaving'
  | 'composing'
  | 'breathing'
  | 'shaping';

type OrbSize = 64 | 20;
type OrbTheme = 'auto' | 'dark' | 'light';
```

| Prop | Default | Notes |
| --- | --- | --- |
| `state` | `working` | Pick from the nine semantic states. |
| `size` | `64` | Only 64 or 20; each is separately tuned. |
| `theme` | `auto` | Dark means light ink; light means dark ink. |
| `speed` | `1` | Multiplier over the selected preset's baked speed. Keep near 1 unless the product has a reason. |
| `paused` | `false` | Freezes the current frame. Remove the running indicator for terminal states rather than leaving it paused indefinitely. |
| `aria-label` | Per-state label | Override with task-specific observable copy. |

Other canvas props such as `className`, `style`, `data-*`, and `aria-hidden` pass through.

## Theme behavior

`theme="auto"` resolves in this order and updates live:

1. An ancestor `data-theme="dark|light"` attribute or `.dark`/`.light` class.
2. `prefers-color-scheme` from the browser/OS.
3. Client-only paint after resolution, avoiding server DOM access.

Use explicit `dark` or `light` when the actual surface theme is not represented by those ancestors or by system appearance—for example, a dark panel inside an otherwise light app.

## Reduced motion and performance

The package automatically:

- renders a static representative frame under `prefers-reduced-motion: reduce`,
- pauses when the canvas is offscreen,
- pauses when the tab is hidden,
- shares a clock across instances,
- and caps device pixel ratio at 2.

Do not replace this with a CSS animation or add a competing infinite transition. Avoid mounting large numbers of animated 64px instances when only one task is active.

## Integration checklist

1. Install `thinking-orbs` with the existing package manager.
2. Use a client wrapper if the framework requires one.
3. Map actual application status to `state`; do not rotate randomly.
4. Choose 20 inline or 64 avatar-scale.
5. Use automatic theme only if its detection matches the surface.
6. Decide whether the orb or nearby status text owns the accessible announcement.
7. Remove/replace the orb on success, failure, cancellation, or input-required states.
8. Run typecheck, tests, and a production build.
9. Test browser dark/light and reduced motion.

## Testing notes

The canvas pixels are implementation detail. Prefer assertions against:

- the `img` role and accessible name,
- the surrounding status text,
- state-to-prop mapping,
- presence/removal across lifecycle states,
- and stable dimensions.

Use visual regression tests only when the project already has a reliable browser screenshot harness.
