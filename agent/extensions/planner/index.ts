import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerHandoff } from "./handoff";

export default function (pi: ExtensionAPI) {
  registerHandoff(pi);
}
