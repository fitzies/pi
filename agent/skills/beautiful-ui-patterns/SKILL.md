---
name: beautiful-ui-patterns
description: Design, implement, or review AI-agent interfaces using a curated catalog inspired by Beautiful UI. Use for agent chat and prompt flows, observable loading/thinking/tool activity, streaming responses, human approval for consequential actions, task progress, recommendations and confidence, citations and retrieved context, generated changes and diffs, or AI-assisted workflows. Trigger when an AI system plans, acts, asks, streams, cites sources, recommends, or modifies user data.
---

# Beautiful UI Patterns

A decision and implementation guide for AI-native product interfaces. Use the local catalog for reliable guidance, adapt every pattern to the product's existing system, and consult the live Beautiful UI site only when current visual or behavioral reference is useful.

This is not a component package. It is a design-reasoning skill that helps select and implement the right interaction pattern without blindly copying a showcase.

## Start here

1. Understand the user's task, the product's audience, and the consequence of the AI action.
2. Inspect the existing framework, components, tokens, typography, spacing, and interaction conventions.
3. Match the need to one primary pattern in [the pattern catalog](./references/pattern-catalog.md). Add supporting patterns only when they clarify a real state or action.
4. Define the state model before styling: idle, queued, running or streaming, waiting for approval, completed, empty, failed, cancelled, and retrying as applicable.
5. Implement in the project's existing stack. Prefer existing primitives and tokens over introducing a parallel design system.
6. Validate keyboard access, focus behavior, screen-reader announcements, responsive layout, reduced motion, and failure/retry paths.
7. Review against [AI-interface principles](./references/ai-interface-principles.md) before finishing.

## Pattern selection

| User need | Primary pattern |
| --- | --- |
| Show that work is underway | Loading State |
| Explain multi-step agent activity without flooding the UI | Thinking |
| Render an answer as it arrives | Streaming Text |
| Ask before a consequential action | Approval Card |
| Summarize tool calls, commands, or edits | Tool Chips |
| Track several jobs and their outcomes | Task Rows |
| Provide an ongoing conversational workspace | Chat |
| Compose prompts with attachments, sources, commands, or model choice | Prompt Bar |
| Present one suggested action with confidence and alternatives | Recommendation Card |
| Show retrieved evidence or knowledge chunks | Context Cards |
| Review proposed changes to structured data | Diff Table |
| Browse and act on relationship-rich records | Records Table |
| Reorganize a compact task set by status | Filter Table |
| Navigate a multi-area agent workspace | Sidebar Nav |
| Find commands, objects, or suggested tasks quickly | Search |
| Build or inspect trigger-and-condition automation | Flowchart |
| Present a generated finding with supporting data | Insight Cards |
| Display generated code with progress and actions | Code Block |
| Let the agent or user tune visual properties | Fine-tune Card |
| Apply an AI action to selected content | Selection Actions |

If several patterns fit, choose the pattern that represents the user's main decision. For example, a recommendation that will place an order should be a Recommendation Card containing an explicit approval action—not a generic chat reply plus an unrelated modal.

## Decision rules

- **Visibility before decoration:** show what the system is doing, what it needs, and what changed before adding visual flourish.
- **Progressive disclosure:** keep routine status compact; allow details such as traces, tool output, citations, and diffs to expand on demand.
- **Consequences require consent:** use an explicit approval pattern before sending external communications, purchasing, deleting, publishing, changing permissions, or applying broad edits. UI consent is not execution authorization: bind approval to the exact action and revalidate its target, scope, permissions, freshness, and material facts at execution time. Prevent accidental duplicate execution with idempotency or an equivalent server-side control.
- **Evidence near claims:** place sources, context, confidence, and assumptions next to the generated conclusion they support.
- **Actions near outcomes:** keep accept, reject, retry, undo, copy, and inspect controls attached to the relevant result.
- **Stable streaming:** avoid layout thrash, preserve reading position, and expose stop/retry controls for long responses.
- **Truthful status:** never show fabricated progress, fake precision, hidden chain-of-thought, or confidence that the system cannot justify. Summarize observable steps instead.
- **Recoverability:** failures should preserve useful work, explain what happened in plain language, and offer a specific retry or fallback.

## Visual direction

Treat the project's design system as the source of truth. Borrow interaction structure, not Beautiful UI's brand styling.

- Use typography, color, spacing, radii, shadows, and icons already present in the product.
- Create hierarchy with spacing and type before adding containers. Avoid turning every message or state into a card.
- Keep agent chrome quieter than user content; status metadata should support the task rather than dominate it.
- Reserve strong color for state, risk, selection, or the primary action.
- Use motion to communicate continuity and state changes. Respect `prefers-reduced-motion`.
- On narrow screens, preserve the main decision and collapse secondary evidence rather than shrinking everything.

When available, apply the `frontend-design` skill as the overall taste and production-quality layer. Use `transitions-dev` only for purposeful state transitions; do not animate every pattern by default.

## Live reference policy

The local references are the default. Consult [Beautiful UI](https://www.beautifului.dev/) with web/browser tools only when:

- the user asks to match or compare with the current site,
- a pattern may have changed since the local snapshot,
- visual or interactive details are essential to the request,
- or the user explicitly requests upstream code.

If live access fails, proceed from the local catalog. Never make normal implementation depend on the site being online.

Before copying upstream code or assets, read [the source and license notes](./references/SOURCES.md) and [the upstream MIT license](./references/LICENSE.md). Prefer an original implementation. Do not copy Beautiful UI branding, demo content, or third-party logos into the user's product.

## Review workflow

When asked to review an AI interface:

1. Locate agent-facing surfaces and their state transitions.
2. Identify missing states, ambiguous status, buried evidence, risky actions without approval, and inaccessible controls.
3. Match each issue to one catalog pattern.
4. Report findings by file and severity when source files are available.
5. Recommend the smallest cohesive set of changes. Do not propose all twenty patterns.
6. Do not edit during a review unless the user asks to apply the findings.

## Implementation output

When implementing:

1. State the selected pattern and why it fits in one sentence.
2. Reuse existing components and tokens.
3. Include real interactions and all relevant states—not a static visual mock.
4. Keep the diff focused and avoid unrelated restyling.
5. Test the critical path, keyboard path, failure path, and responsive behavior.
6. Summarize changed files and any follow-up work.

## Reference index

- [Pattern catalog](./references/pattern-catalog.md) — selection, anatomy, states, and pitfalls for all 20 patterns.
- [AI-interface principles](./references/ai-interface-principles.md) — trust, disclosure, streaming, approvals, accessibility, and visual quality.
- [Sources](./references/SOURCES.md) — provenance, snapshot date, and refresh policy.
- [Upstream license](./references/LICENSE.md) — Beautiful UI's published MIT license; included for provenance, not as a declaration of this skill package's license.
