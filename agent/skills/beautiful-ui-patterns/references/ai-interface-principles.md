# AI-interface principles

Use these checks when designing, implementing, or reviewing AI-native product surfaces.

## 1. Make system state legible

At any moment, users should be able to answer:

- Did the system receive my request?
- Is it waiting, working, streaming, blocked, or finished?
- What can I do now?
- What changed?

Use consistent language and status semantics across loaders, tool calls, tasks, and messages. A pulsing dot should not mean “queued” in one place and “failed” in another.

## 2. Separate observation, inference, and action

An AI response may contain three different things:

- **Observation:** what the source data says.
- **Inference:** what the model concludes from it.
- **Action:** what the system recommends or intends to do.

Visually and verbally distinguish them. Evidence belongs near the observation; assumptions and confidence belong near the inference; approval and undo belong near the action.

## 3. Use progressive disclosure

Most people need a clear outcome first, not every event. Keep routine details compact while making them inspectable:

- One-line current status by default.
- Expandable tool calls and operational traces.
- Inline citations with deeper source cards on demand.
- Summary diffs before raw logs.

Do not use disclosure to hide failures, costs, risks, or irreversible effects.

## 4. Ask for approval at the right boundary

Require explicit confirmation before actions that are external, destructive, expensive, privacy-sensitive, or broad in scope. The approval should state:

- the exact action,
- the target and scope,
- meaningful consequences,
- any cost or recipients,
- and whether undo is available.

Approval must be fresh: if relevant context changes, invalidate the old approval rather than reusing it silently.

The interface records consent; it is not the authorization boundary. Bind consent to an immutable description of the exact action, then revalidate identity, permissions, target, scope, price or other material state at execution time. Use idempotency keys or an equivalent server-side mechanism so retries and double clicks cannot execute the action twice.

## 5. Make confidence useful

Only show confidence if the product has a defensible basis for it. Prefer calibrated language and evidence over arbitrary percentages.

Useful confidence communicates why:

- strong agreement across current sources,
- incomplete or stale data,
- an assumption that needs review,
- a reversible recommendation versus a risky one.

A “High confidence” badge without rationale is decoration, not information.

## 6. Design streaming as a real state

Streaming is not merely a typing animation.

- Keep the container stable as content grows.
- Do not steal scroll position after the user moves away from the end.
- Allow stop and retry when generation is lengthy.
- Distinguish incomplete from complete content.
- Defer follow-up actions until they are valid.
- Batch screen-reader announcements so updates remain understandable.
- Preserve completed text if the stream fails.

## 7. Show observable activity, not hidden reasoning

It can be useful to show safe operational summaries such as “Searching vendor records,” “Comparing 12 results,” or “Running tests.” Do not claim to expose private chain-of-thought and do not invent activity to make the interface feel busy.

Operational traces must avoid secrets, credentials, private prompts, unnecessary personal data, and raw logs that could expose them.

## 8. Preserve agency and reversibility

For generated changes:

- preview before apply,
- support per-item selection for batches,
- provide cancel while feasible,
- retain user-authored input,
- offer undo or a clear rollback path,
- and never obscure which changes came from the agent.

A polished animation does not compensate for a missing escape route.

## 9. Treat failures as first-class states

Failure copy should explain what failed, what remains intact, and the next useful action. Preserve partial results when safe. Differentiate retryable failures, validation problems, permission issues, network loss, and stale context.

Avoid generic “Something went wrong” when the system knows more.

## 10. Build for accessibility

### Semantics and keyboard

- Use native controls and headings before custom roles.
- Keep focus visible and logical as content streams or panels open.
- Return focus after dialogs, popovers, and contextual actions close.
- Ensure grids, menus, and flow editors have documented keyboard paths.
- Do not make hover the only way to inspect evidence or actions.

### Announcements

- Use restrained live regions for status and completion.
- Avoid announcing every streamed token or progress tick.
- Announce meaningful count changes and failures.
- Keep visual status text available; do not rely only on an icon.

### Perception

- Never rely on color alone for status or diffs.
- Maintain readable contrast for secondary metadata.
- Provide text equivalents for charts and graphical workflows.
- Respect reduced motion and avoid unnecessary continuous animation.

## 11. Make responsive behavior task-aware

On narrow screens:

- keep the primary decision and action visible,
- collapse secondary traces and metadata,
- convert wide tables to a deliberate card/detail or horizontal-inspection pattern,
- provide a list representation for flowcharts,
- and prevent composers from crowding out conversation history.

Do not solve responsiveness by shrinking text and controls below usable sizes.

## 12. Fit the product's visual system

AI-native does not require a separate aesthetic. Reuse the product's typography, spacing, colors, components, and voice. Status chrome should be quieter than the user's work. Use cards when a surface has a real boundary, not as the default wrapper for every fragment.

One coherent interface with fewer patterns is better than a catalog demonstration.

## Final review checklist

- Is the primary user task obvious?
- Is current system status truthful and visible?
- Are incomplete and final outputs distinguishable?
- Is evidence attached to the claims it supports?
- Are consequential actions gated by explicit approval?
- Are generated changes previewable and reversible?
- Do empty, loading, error, cancellation, and retry states exist?
- Can the critical flow be completed with a keyboard?
- Are status and diffs understandable without color?
- Does streaming preserve reading and screen-reader usability?
- Does the UI use the existing design system rather than imitate the reference site?
- Is every included pattern doing necessary work?
