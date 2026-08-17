---
name: frontend-design
description: Create, modify, or review frontend UI with stronger default design taste. Use automatically whenever working on web components, pages, app interfaces, CSS, Tailwind, design systems, responsive layout, UX copy, interaction states, or visual polish. Produces distinctive, production-grade interfaces and avoids generic AI aesthetics.
license: Adapted from Anthropic frontend-design skill; original terms in upstream repository.
---

# Frontend Design

Use this skill as a default taste layer for frontend work. The goal is not to add decoration. The goal is to produce working UI that feels intentionally designed, context-specific, accessible, and production-ready.

## Operating Mode

When creating or changing frontend UI:

1. Understand the product context before styling.
2. Choose a clear aesthetic direction.
3. Implement real working code, not mock-only suggestions.
4. Match the existing codebase, framework, tokens, and components unless asked to redesign.
5. Prefer fewer, stronger choices over many weak decorative effects.
6. Review the result for generic AI tells before finishing.

Do not wait for a slash command. Apply these standards by default whenever the task touches UI.

## Design Thinking

Before coding, decide:

- **Purpose**: What job does this interface perform? Who uses it, and under what pressure?
- **Register**: Is this brand/marketing UI where design carries the story, or product UI where design supports speed, clarity, and trust?
- **Tone**: Pick a committed direction: brutally minimal, industrial, organic, editorial, playful, luxury, utilitarian, retro-futuristic, soft, raw, geometric, or another context-specific style.
- **Constraints**: Framework, accessibility, performance, responsiveness, browser support, and existing design system.
- **Memorable move**: Name one thing that makes the interface recognizable without making it noisy.

Bold maximalism and refined minimalism can both work. The key is intentionality and precise execution.

## Implementation Standards

Write code that is:

- Functional and production-grade.
- Responsive across realistic viewport sizes.
- Accessible by default: semantic markup, focus states, keyboard paths, sufficient contrast, reduced-motion support when animating.
- Cohesive: typography, spacing, color, motion, and copy should feel from one system.
- Integrated with existing project conventions rather than inventing a parallel design system.

## Frontend Aesthetics Guidelines

### Typography

- Treat type as a design decision, not a default.
- Avoid reflexively using Inter, Roboto, Arial, or generic system stacks for brand surfaces.
- Pair a distinctive display face with a restrained body face when the project allows external fonts.
- For product UI, prioritize legibility, hierarchy, line length, and rhythm over expressive novelty.
- Use type scale and weight deliberately. Do not make everything medium-bold.

### Color and Theme

- Commit to a coherent color strategy.
- Use CSS variables or existing tokens for repeatable decisions.
- Prefer tinted neutrals over pure black/white when appropriate.
- Avoid timid palettes where every color has equal weight.
- Avoid cliché AI palettes, especially purple/cyan gradients, gradient text, and white SaaS surfaces with random accent blobs unless the brand truly calls for them.

### Layout and Space

- Use spacing to create hierarchy before adding borders, shadows, or cards.
- Avoid wrapping everything in cards. Nested cards are usually a smell.
- Vary rhythm: tight related groups, generous section breaks.
- Consider asymmetry, overlap, editorial flow, or controlled density when suitable.
- For dashboards/tools, optimize scanning, alignment, states, and information density.

### Motion and Interaction

- Motion should communicate state, continuity, or affordance, not just decorate.
- Prefer transform and opacity animations. Avoid animating layout properties when performance matters.
- Use hover, active, focus, loading, empty, error, and disabled states intentionally.
- Respect `prefers-reduced-motion`.
- One strong orchestrated moment is better than many scattered micro-animations.

### Visual Detail

- Add atmosphere only when it supports the direction: texture, grain, geometric pattern, layered depth, dramatic shadow, custom border, or subtle background treatment.
- Make decorative elements feel specific to the product, not pasted on.
- Minimal designs still need craft: spacing, alignment, contrast, copy, and state design.

## Interface Craft Checklist

Adapted from the [Interfaces cheat sheet](https://interfaces.dev/cheat-sheet). Apply these details when relevant rather than forcing every rule into every interface.

### UI and layout

- Use concentric radii for nested rounded elements and optical—not merely geometric—alignment.
- Make spacing between groups at least twice the spacing within a group.
- Prefer logical CSS properties and avoid fixed dimensions on text containers.
- Give images a subtle inset outline when they need separation from their background.

### Type and content

- Self-host web fonts as WOFF2 when practical.
- Use tabular numerals for changing values, prices, timers, and aligned numeric columns.
- Keep long-form text near 60–75 characters per line; balance headings and use pretty wrapping for short descriptions.
- Prevent long links and IDs from escaping; preserve full truncated values via a tooltip or expanded view.
- Store copy in natural case, use smart punctuation, and keep capitalization consistent.
- Start action labels with verbs, repeat consequences in destructive confirmations, use descriptive link text, and offer one useful next action in empty states.

### Color and tokens

- Give every palette step a real purpose and expose component styling through semantic tokens rather than raw palette values.
- Name tokens by role, not appearance or first use; do not reuse a token merely because its current color matches.
- Measure contrast against the element's actual rendered background.
- Design dark mode independently rather than reversing the light palette, and use one theme-switching mechanism consistently.

### Interaction and motion

- Never use `transition: all`; name only the changing properties.
- Use interruptible transitions for interaction feedback and keyframes for one-shot sequences.
- Keep press feedback subtle, cross-fade icon swaps, and avoid animating high-frequency list interactions.
- Stagger entrances by meaningful groups, disable transitions during theme changes, and reserve `will-change` for properties that actually animate.
- Put hover-only styling behind `@media (hover: hover)` and motion behind `prefers-reduced-motion: no-preference`.

### Accessibility details

- Prefer native semantic controls, real labels, suitable `type` and `inputmode`, visible `:focus-visible` styles, and natural tab order.
- Give icon-only controls descriptive accessible names; never hide a focusable element from assistive technology.
- Never block paste. Validate on submit, connect errors with `aria-describedby`, mark invalid fields, and focus the first error.
- Keep controls reachable: at least 24×24px, preferably 40×40px on desktop and 44×44px on touch, without overlapping hit areas.
- Keep disabled-control explanations visible or use `aria-disabled` when the control must remain focusable.
- Use `role="status"` for routine updates and `role="alert"` only for urgent errors; never communicate state through color alone.
- Ensure decorative layers cannot intercept pointer events and make the skip link the first focusable element.

## Avoid Generic AI UI

Actively reject these unless explicitly requested or already part of the product identity:

- Purple-to-cyan gradients.
- Gradient text headings.
- Inter/Roboto/system font monoculture on brand surfaces.
- Repeated icon-card grids with identical structure.
- Cards inside cards inside cards.
- Glassmorphism as a default.
- Giant rounded rectangles with generic shadows.
- Hero layouts that look like every SaaS landing page.
- Low-contrast gray text.
- Every button styled as primary.
- Modal-first interaction design when inline disclosure would work.

## Final Self-Check

Before finishing frontend work, verify:

- Does this fit the product and audience?
- Is there a clear visual hierarchy?
- Are spacing, type, and color internally consistent?
- Are responsive behavior and interaction states handled?
- Is accessibility acceptable?
- Did any generic AI aesthetic slip in?
- Is the result simpler than it needs to be, or more decorative than it deserves?

If the answer exposes a weakness, fix it before handing off.
