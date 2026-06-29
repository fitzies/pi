import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerFileChanges } from "./filechanges";
import { registerOpenCommand } from "./open";

export default async function workspaceChangesExtension(pi: ExtensionAPI): Promise<void> {
  registerFileChanges(pi);
  await registerOpenCommand(pi);
}
