# AI-native interface pattern catalog

Curated from the 20 patterns published at [Beautiful UI](https://www.beautifului.dev/), then expanded into implementation-neutral product guidance. These are interaction structures, not prescribed visual styles.

## 1. Loading State

**Use when:** work has started but no meaningful result is available yet.

**Anatomy:** concise status label, restrained progress signal, optional elapsed time, stop/cancel action when useful.

**States:** queued, running, delayed, completed, failed, cancelled.

**Guidance:** distinguish indeterminate activity from measurable progress. Show elapsed time only if it helps users judge whether to wait. Replace generic “Loading…” with the observable operation when known.

**Avoid:** fake percentages, endlessly looping novelty animation, or a loader that hides available partial results.

## 2. Thinking

**Use when:** an agent performs multiple observable steps and users may need reassurance or diagnostics.

**Anatomy:** compact summary, current step, expandable trace of safe operational events such as searching, reading, comparing, coding, or calling tools.

**States:** collapsed running, expanded running, completed, interrupted, failed.

**Guidance:** summarize actions and evidence, not private chain-of-thought. Keep the default view quiet and retain completed steps only when they remain useful.

**Avoid:** invented narration, exposing secrets or raw hidden reasoning, and forcing users to watch every low-level event.

## 3. Streaming Text

**Use when:** a generated answer arrives incrementally and early content is useful.

**Anatomy:** stable response region, streaming indicator, inline citations, answer actions, stop control, follow-up suggestions after completion.

**States:** starting, streaming, paused or interrupted, complete, failed, regenerating.

**Guidance:** preserve scroll position and selection, render complete semantic units when possible, and separate citations from decorative badges. Announce updates without making screen readers repeat the entire response.

**Avoid:** aggressive auto-scroll, controls that jump as text grows, or treating an unfinished answer as final.

## 4. Approval Card

**Use when:** the system needs a choice or confirmation before continuing, especially for consequential actions.

**Anatomy:** direct question, necessary context, clearly differentiated options, impact summary, cancel path.

**States:** awaiting choice, submitted, expired, invalidated by changed context.

**Guidance:** make the exact action and scope explicit. For destructive or external effects, show target, quantity, cost, recipients, or permissions before approval. Treat the card as a request for consent, not authorization by itself: bind the response to the exact proposed action, revalidate permissions and material facts at execution time, expire stale approvals, and prevent duplicate execution with idempotency or an equivalent server-side control.

**Avoid:** preselecting risky consent, vague “Continue?” copy, styling all choices as equally primary, or trusting client-side approval state as the sole enforcement boundary.

## 5. Tool Chips

**Use when:** tool calls, code edits, commands, or messages should be visible without dominating the conversation.

**Anatomy:** tool/action label, target, status icon, compact result summary, expandable details.

**States:** queued, running, succeeded, warning, failed, cancelled.

**Guidance:** group related calls, surface failures, and show enough context to distinguish similar operations. Keep raw logs behind disclosure.

**Avoid:** one chip per trivial event, success styling before completion, or hiding an actionable failure in a collapsed group.

## 6. Task Rows

**Use when:** several independent or sequential jobs need live status and individual actions.

**Anatomy:** task name, status, progress or substatus, optional owner/target, row-level action, summary counts.

**States:** blocked, queued, running, completed, failed, cancelled, retrying.

**Guidance:** use persistent positions so rows do not reorder unexpectedly while users scan. Show blockers and dependencies directly.

**Avoid:** progress bars without measurable progress, color-only status, or collapsing failed tasks into a generic total.

## 7. Chat

**Use when:** iterative conversation is the primary workspace rather than a one-shot command.

**Anatomy:** conversation history, role distinction, composer, context or mode indicator, message actions, connection and generation status.

**States:** empty, composing, sending, generating, complete, failed, offline, history loading.

**Guidance:** keep user input and system output visually distinct without excessive bubbles. Preserve drafts and make message-level retry/edit behavior predictable.

**Avoid:** hiding important product controls inside prose, nesting every artifact in chat, or losing context when switching tabs or threads.

## 8. Prompt Bar

**Use when:** users need to compose requests with attachments, sources, commands, models, voice, or other context.

**Anatomy:** multiline input, attachment/source affordance, selected-context chips, send/stop control, optional model or mode picker.

**States:** empty, composing, uploading, ready, submitting, generating, validation error.

**Guidance:** show exactly what context will be sent. Support keyboard submission without making newlines difficult. Keep advanced controls available but secondary.

**Avoid:** an overloaded toolbar, ambiguous attachment state, or placeholders that substitute for persistent labels.

## 9. Recommendation Card

**Use when:** the agent proposes one concrete action and users need rationale, confidence, alternatives, and control.

**Anatomy:** recommendation, rationale/evidence, confidence with basis, alternatives, accept/reject/inspect actions.

**States:** ready, needs review, accepted, rejected, superseded, executing, completed, failed.

**Guidance:** explain confidence in human terms and expose material assumptions. If accepting has consequences, transition into explicit approval or combine approval into the card.

**Avoid:** unsupported confidence percentages, hiding meaningful alternatives, or making acceptance visually coercive.

## 10. Context Cards

**Use when:** retrieved documents, records, or knowledge chunks support an answer or are included in a prompt.

**Anatomy:** source title, type, relevant excerpt, provenance, freshness, selection state, open/remove action.

**States:** retrieved, selected, excluded, stale, unavailable, permission-restricted.

**Guidance:** show why a chunk is relevant and keep source identity visible. Distinguish quoted source text from generated interpretation.

**Avoid:** decontextualized snippets, inaccessible source links, and implying that retrieval guarantees correctness.

## 11. Diff Table

**Use when:** AI proposes additions, removals, or edits across structured rows or fields.

**Anatomy:** stable identifiers, before/after values, change type, per-row selection, aggregate count, apply/reject actions.

**States:** proposed, selected, deselected, conflicting, applying, applied, partially applied, failed, reverted.

**Guidance:** make unchanged context available, preserve row identity through sorting/filtering, and provide a reviewable summary before batch apply.

**Avoid:** relying on red/green alone, applying hidden rows, or losing the original value after an error.

## 12. Records Table

**Use when:** users browse a substantial set of entities with relationships, metadata, sorting, and row actions.

**Anatomy:** clear columns, stable row identity, sorting/filtering, selection, pagination or virtualization, row details/actions.

**States:** loading, populated, empty, filtered-empty, partial, stale, failed.

**Guidance:** prioritize scanability and column alignment. Keep important identity fields sticky where appropriate and support keyboard navigation for interactive grids.

**Avoid:** turning every cell into a chip, truncating without access to full values, or using a desktop table unchanged on mobile.

## 13. Filter Table

**Use when:** a compact work list is reorganized by a small set of meaningful statuses.

**Anatomy:** status filters with counts, task rows, current filter, empty state, optional sorting.

**States:** all, filtered, filtered-empty, updating, failed.

**Guidance:** preserve filter state, make counts trustworthy, and announce result-count changes accessibly.

**Avoid:** ambiguous active filters, status encoded only by color, and surprising resets after row updates.

## 14. Sidebar Nav

**Use when:** an agent product has multiple work areas, objects, histories, or quick actions.

**Anatomy:** workspace identity, primary destinations, grouped objects, current location, search/new-task affordances, collapse behavior.

**States:** expanded, collapsed, mobile overlay, item loading, disconnected, permission-limited.

**Guidance:** prioritize frequent destinations, keep current location obvious, and provide a predictable mobile alternative.

**Avoid:** mixing navigation with transient task status indiscriminately or using icons without labels in unfamiliar domains.

## 15. Search

**Use when:** users need fast access to commands, records, conversations, or suggested tasks.

**Anatomy:** query input, scoped categories, recent/suggested items, live results, result metadata, empty state, keyboard hints.

**States:** idle, querying, results, no results, failed, offline.

**Guidance:** support keyboard-first use, explain result scope, and distinguish navigation from actions that execute immediately.

**Avoid:** executing consequential commands on a single Enter without confirmation or showing stale suggestions as live results.

## 16. Flowchart

**Use when:** users create or inspect workflows made of triggers, conditions, branches, and actions.

**Anatomy:** nodes, typed connectors, branch labels, selection/inspector, viewport controls, validation and run status.

**States:** valid, incomplete, invalid, simulating, running, paused, failed.

**Guidance:** make flow direction and branch conditions readable without color. Offer a linear or list representation for accessibility and narrow screens.

**Avoid:** decorative node graphs with unclear execution order, tiny connection targets, or errors visible only after publishing.

## 17. Insight Cards

**Use when:** the agent presents a finding, trend, anomaly, or forecast backed by data.

**Anatomy:** concise claim, magnitude, comparison period, evidence visualization, provenance, next action, navigation among insights.

**States:** loading, ready, low confidence, stale data, insufficient data, failed.

**Guidance:** state units and comparison baselines, separate observation from recommendation, and make charts readable without hover.

**Avoid:** dramatic claims without baselines, decorative charts, or burying data freshness.

## 18. Code Block

**Use when:** generated code is an artifact users need to read, copy, inspect, or apply.

**Anatomy:** filename/language, code, generation status, copy/apply/open actions, validation result, optional diff.

**States:** streaming, complete, truncated, validated, validation failed, applied.

**Guidance:** preserve horizontal readability, label untested code honestly, and prefer diffs when modifying existing files.

**Avoid:** claiming code is verified without running checks, auto-applying large changes, or making line-by-line animation impede reading.

## 19. Fine-tune Card

**Use when:** users adjust generated visual or behavioral properties through structured controls.

**Anatomy:** selected target, grouped properties, current values, live preview, reset/undo, apply action.

**States:** unchanged, modified, previewing, invalid, applying, applied, reverted.

**Guidance:** constrain values to valid ranges, keep preview and source state synchronized, and expose undo.

**Avoid:** controls with unclear units, silently overwriting design tokens, or applying every adjustment irreversibly in real time.

## 20. Selection Actions

**Use when:** selecting text or another artifact should reveal contextual AI actions such as explain, improve, shorten, change tone, or fix grammar.

**Anatomy:** anchored action menu, concise verbs, selection context, preview/result, replace/insert/cancel controls.

**States:** selection active, generating, preview ready, applied, dismissed, failed.

**Guidance:** preserve the original selection and offer preview or undo before replacement. Keep the menu out of the way of native copy behavior.

**Avoid:** replacing content immediately, losing selection when the action menu opens, or showing irrelevant actions for the selected content type.

## Combining patterns

Use combinations only when each has a distinct job:

- **Chat + Prompt Bar** for a conversational workspace with rich context entry.
- **Thinking + Tool Chips + Task Rows** for long-running agent work at three levels: summary, operations, and jobs.
- **Streaming Text + Context Cards** for generated answers grounded in retrieved material.
- **Recommendation Card + Approval Card** for a suggestion followed by consequential consent.
- **Diff Table + Approval Card** for reviewing and applying broad structured edits.
- **Insight Cards + Context Cards** for claims with inspectable evidence.
- **Code Block + Tool Chips** for generated code plus build/test activity.

Do not stack patterns merely to reproduce a showcase. The product's primary task should remain visually dominant.
