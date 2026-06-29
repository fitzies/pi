import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const messages = [
  "Bugmaxxing...",
  "Tokenmaxxing...",
  "Shipmaxxing...",
  "Patchmaxxing...",
  "Diffmaxxing...",
  "Contextmaxxing...",
  "Latencymaxxing...",
  "Throughputmaxxing...",
  "Cachemaxxing...",
  "Promptmaxxing...",
  "Refactormaxxing...",
  "Testmaxxing...",
  "Lintmaxxing...",
  "Typemaxxing...",
  "Stackmaxxing...",
  "Buildmaxxing...",
  "Debugmaxxing...",
  "Commitmaxxing...",
  "Branchmaxxing...",
  "Querymaxxing...",
  "Indexmaxxing...",
  "Perfmaxxing...",
  "Apimaxxing...",
  "Logmaxxing...",
  "Configmaxxing...",

  "Bug mogging...",
  "Diff mogging...",
  "Stack mogging...",
  "Token mogging...",
  "Compiler mogging...",
  "Latency mogging...",

  "Locking in...",
  "Dialing in...",
  "Cooking...",
  "Still cooking...",
  "Patch cooking...",
  "Diff cooking...",
  "Tests cooking...",
  "Letting cook...",

  "Finding alpha...",
  "Shipping alpha...",
  "Stack alpha...",
  "Token alpha...",
  "Bug arbitrage...",
  "Context arbitrage...",
  "Diff arbitrage...",

  "Bug hunting...",
  "Patch hunting...",
  "Context hunting...",
  "Token farming...",
  "Cache farming...",
  "Diff farming...",
  "Signal farming...",

  "Optimizing...",
  "Tuning...",
  "Profiling...",
  "Refactoring...",
  "Compiling aura...",
  "Reading stack...",
  "Parsing vibes...",
  "Tracing bugs...",
  "Pushing pixels...",
  "Moving bytes...",
];

function pickRandom() {
  return messages[Math.floor(Math.random() * messages.length)]!;
}

export default function (pi: ExtensionAPI) {
  const resetWorkingMessage = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    ctx.ui.setWorkingMessage();
  };

  pi.on("turn_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setWorkingMessage(pickRandom());
  });

  pi.on("turn_end", async (_event, ctx) => {
    resetWorkingMessage(ctx);
  });

  // Abort/error paths may not always emit turn_end; don't leave a whimsical
  // message looking like pi is still doing work after the agent has stopped.
  pi.on("agent_end", async (_event, ctx) => {
    resetWorkingMessage(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    resetWorkingMessage(ctx);
  });
}
