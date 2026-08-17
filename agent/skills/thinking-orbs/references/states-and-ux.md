# States and UX guidance

Thinking Orbs is an animated categorical status indicator for AI and agent interfaces. It answers “what kind of work is happening?” It does not communicate exact progress, confidence, or success.

## State catalog

### `working`

**Visual:** particles on tilted orbits.

**Use for:** a mixed or generic execution phase, tool work that changes frequently, or activity with no more specific truthful state.

**Default label:** “Working…”

### `searching`

**Visual:** a scan meridian sweeps a dotted globe.

**Use for:** web search, retrieval, scanning records, locating files, indexing, or lookup.

**Default label:** “Searching…”

Do not use for general reasoning that performs no search.

### `solving`

**Visual:** bands scramble and click back into alignment.

**Use for:** resolving constraints, calculating, debugging a bounded problem, planning from known inputs, or evaluating alternatives.

**Default label:** “Solving…”

### `listening`

**Visual:** a waveform rolls through latitude rings.

**Use for:** microphone input, speech recognition, audio capture, or an agent actively accepting spoken input.

**Default label:** “Listening…”

Stop promptly when capture ends or permission is denied. Do not imply that a microphone is active when it is not.

### `connecting`

**Visual:** a constellation wires itself together.

**Use for:** establishing a network/service/device connection, authenticating a connector, or linking data sources.

**Default label:** “Connecting…”

Use a different state once the connection is established and work begins.

### `weaving`

**Visual:** three strands plait around the sphere.

**Use for:** combining several sources, merging parallel agent outputs, synthesizing evidence, or reconciling multiple streams.

**Default label:** “Weaving…”

### `composing`

**Visual:** an undulating multi-band sash.

**Use for:** drafting prose, generating a message, writing a report, producing code, or composing another content artifact.

**Default label:** “Composing…”

If content streams visibly, keep the orb subordinate to the streamed result and stop it when generation completes.

### `breathing`

**Visual:** a slowly morphing face-on ring.

**Use for:** calm indeterminate thinking, a low-intensity wait, or a deliberately quiet status where `working` would feel too energetic.

**Default label:** “Thinking…”

### `shaping`

**Visual:** a dotted outline morphs circle → triangle → square.

**Use for:** structuring an artifact, transforming a representation, formatting, generating layout, or progressively forming an output.

**Default label:** “Shaping…”

## State lifecycle

Drive `state` from the same state machine that drives the textual status. A useful lifecycle might be:

1. `connecting` while establishing a service.
2. `searching` while retrieving sources.
3. `weaving` or `solving` while combining/evaluating results.
4. `composing` while drafting the response.
5. Remove or pause the orb when complete.

Only include phases that genuinely occur. Avoid decorative state rotation.

The orb should stop or be replaced when:

- work succeeds,
- work fails,
- the user cancels,
- the operation is blocked,
- approval or input is required,
- the app loses the task,
- or the displayed result is final.

Pair terminal states with explicit UI: result content, success confirmation, error/retry treatment, cancellation copy, or an approval/input surface.

## Status copy

The default per-state labels are useful fallbacks but product-specific copy is often clearer:

- “Searching vendor records…” rather than “Searching…”
- “Connecting to calendar…” rather than “Connecting…”
- “Drafting your summary…” rather than “Composing…”

Keep copy observable and honest. Do not expose hidden chain-of-thought or narrate internal reasoning. Describe operations, inputs, and outcomes the product can actually verify.

## Accessibility

- Animation alone must never be the only status signal.
- Provide an accessible label through the component API or a nearby status region.
- Announce meaningful phase changes, completion, and failure—not every frame or tiny internal event.
- Avoid duplicate announcements when both the orb and adjacent text are accessible.
- Reduced motion should retain the state through a static frame and text; do not remove all indication of activity.
- Do not rely on ink brightness alone to distinguish states; state meaning comes from the label and context.

## Placement

- Reserve a stable square slot so state changes do not shift nearby text.
- Align the 20 preset optically with the status line, not mechanically to a text baseline if that looks low.
- Use the 64 preset as an agent/avatar-scale object with enough surrounding quiet space.
- Avoid displaying many continuously animated 64 orbs in a scrolling list. Prefer a 20 orb for the actively running row and static statuses for the rest.
- Keep the host background sufficiently uniform for monochrome dots to remain legible.

## Motion restraint

Thinking Orbs already provides continuous internal motion. Surrounding UI should usually enter/exit with a short opacity/transform transition and remain still while the orb runs. Do not add:

- a pulsing outer ring,
- animated gradient backplates,
- constant glow breathing,
- container rotation,
- or multiple simultaneous orb variants for one task.

The product status, not the decorative effect, should remain primary.
