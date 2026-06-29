import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  formatSize,
  keyHint,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

function resultText(result: any): string {
  const block = result?.content?.find?.((item: any) => item?.type === "text");
  return typeof block?.text === "string" ? block.text : "";
}

function bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function lineCount(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function basename(path?: string): string {
  if (!path) return "";
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function compact(theme: any, label: string, parts: Array<string | undefined>, expanded: boolean): Text {
  const hint = expanded ? "" : ` · ${keyHint("app.tools.expand", "to expand")}`;
  return new Text(`${theme.fg("success", `✓ ${label}`)} · ${parts.filter(Boolean).join(" · ")}${hint}`, 0, 0);
}

function full(result: any): Text {
  return new Text(resultText(result), 0, 0);
}

function argBytes(value: unknown): number {
  return bytes(typeof value === "string" ? value : JSON.stringify(value ?? ""));
}

function firstLine(text: string, max = 80): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export default function (pi: ExtensionAPI) {
  const cwd = process.cwd();

  const read = createReadToolDefinition(cwd);
  pi.registerTool({
    ...read,
    renderCall(args, theme, context) {
      if (context.expanded) return read.renderCall?.(args, theme, context) ?? new Text(JSON.stringify(args, null, 2), 0, 0);
      const range = args.offset || args.limit ? `lines ${args.offset ?? 1}${args.limit ? `-${(args.offset ?? 1) + args.limit - 1}` : "+"}` : undefined;
      return compact(theme, "Read", [basename(args.path), range], false);
    },
    renderResult(result, options, theme, context) {
      if (options.isPartial) return read.renderResult?.(result, options, theme, context) ?? full(result);
      if (options.expanded) return read.renderResult?.(result, options, theme, context) ?? full(result);
      const text = resultText(result);
      const path = context.args?.path;
      const offset = context.args?.offset;
      const limit = context.args?.limit;
      const range = offset || limit ? `lines ${offset ?? 1}${limit ? `-${(offset ?? 1) + limit - 1}` : "+"}` : undefined;
      const trunc = (result as any)?.details?.truncation?.truncated ? "truncated" : undefined;
      return compact(theme, "Read", [basename(path), range, `${lineCount(text)} lines`, formatSize(bytes(text)), trunc], false);
    },
  });

  const bash = createBashToolDefinition(cwd);
  pi.registerTool({
    ...bash,
    renderCall(args, theme, context) {
      if (context.expanded) return bash.renderCall?.(args, theme, context) ?? new Text(args.command ?? "", 0, 0);
      const command = String(args.command ?? "");
      const commandLines = lineCount(command);
      const summary = command.includes("\n") ? `${firstLine(command)} · ${commandLines} command lines` : firstLine(command);
      return compact(theme, "Bash", [summary], false);
    },
    renderResult(result, options, theme, context) {
      if (options.isPartial) return bash.renderResult?.(result, options, theme, context) ?? full(result);
      if (options.expanded) return bash.renderResult?.(result, options, theme, context) ?? full(result);
      const text = resultText(result);
      const command = String(context.args?.command ?? "").split("\n")[0].slice(0, 80);
      const trunc = (result as any)?.details?.truncation?.truncated ? "truncated" : undefined;
      return compact(theme, "Bash", [command, `${lineCount(text)} lines`, formatSize(bytes(text)), trunc], false);
    },
  });

  const edit = createEditToolDefinition(cwd);
  pi.registerTool({
    ...edit,
    renderCall(args, theme, context) {
      if (context.expanded) return edit.renderCall?.(args, theme, context) ?? new Text(JSON.stringify(args, null, 2), 0, 0);
      const count = Array.isArray(args.edits) ? args.edits.length : undefined;
      return compact(theme, "Edit", [basename(args.path), count === undefined ? undefined : `${count} replacement${count === 1 ? "" : "s"}`, formatSize(argBytes(args.edits))], false);
    },
    renderResult(result, options, theme, context) {
      if (options.isPartial) return edit.renderResult?.(result, options, theme, context) ?? full(result);
      if (options.expanded) return edit.renderResult?.(result, options, theme, context) ?? full(result);
      const path = context.args?.path;
      const count = Array.isArray(context.args?.edits) ? context.args.edits.length : undefined;
      const diff = (result as any)?.details?.diff ?? resultText(result);
      return compact(theme, "Edit", [basename(path), count === undefined ? undefined : `${count} replacement${count === 1 ? "" : "s"}`, formatSize(bytes(diff))], false);
    },
  });

  const write = createWriteToolDefinition(cwd);
  pi.registerTool({
    ...write,
    renderCall(args, theme, context) {
      if (context.expanded) return write.renderCall?.(args, theme, context) ?? new Text(JSON.stringify(args, null, 2), 0, 0);
      const content = String(args.content ?? "");
      return compact(theme, "Write", [basename(args.path), `${lineCount(content)} lines`, formatSize(bytes(content))], false);
    },
    renderResult(result, options, theme, context) {
      if (options.isPartial) return write.renderResult?.(result, options, theme, context) ?? full(result);
      if (options.expanded) return write.renderResult?.(result, options, theme, context) ?? full(result);
      const content = String(context.args?.content ?? "");
      return compact(theme, "Write", [basename(context.args?.path), `${lineCount(content)} lines`, formatSize(bytes(content))], false);
    },
  });
}
