import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerFooter } from "./footer";
import { registerHeader } from "./header";

export default function uiChromeExtension(pi: ExtensionAPI): void {
  registerHeader(pi);
  registerFooter(pi);
}
