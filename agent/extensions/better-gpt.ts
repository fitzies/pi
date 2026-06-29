import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Container, Image, Text } from "@earendil-works/pi-tui";

const SERVICE_TIER = "priority";
const STATUS_KEY = "better-gpt";
const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const DEFAULT_IMAGE_MODEL = "gpt-5.5";
const DEFAULT_TIMEOUT_MS = 180_000;
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
const AUTH_FILE = join(AGENT_DIR, "auth.json");
const DEFAULT_FAST_MODELS = new Set([
  "openai/gpt-5.4",
  "openai/gpt-5.5",
  "openai-codex/gpt-5.4",
  "openai-codex/gpt-5.5",
]);

const ImageParamsSchema = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "Image generation/edit prompt." },
    images: {
      type: "array",
      items: { type: "string" },
      description: "Local reference/edit image paths.",
    },
    action: { type: "string", enum: ["auto", "generate", "edit"] },
    model: {
      type: "string",
      description: "OpenAI Codex model. Defaults to current openai-codex model or gpt-5.5.",
    },
    outputFormat: { type: "string", enum: ["png", "jpeg", "webp"] },
    save: { type: "boolean", description: "Save image to disk. Defaults to true." },
    saveDir: { type: "string", description: "Directory to save into. Defaults to .pi/generated-images." },
  },
  required: ["prompt"],
  additionalProperties: false,
} as const;

type ImageAction = "auto" | "generate" | "edit";
type ImageFormat = "png" | "jpeg" | "webp";
type ImageParams = {
  prompt: string;
  images?: string[];
  action?: ImageAction;
  model?: string;
  outputFormat?: ImageFormat;
  save?: boolean;
  saveDir?: string;
};

type Credentials = { accessToken: string; accountId: string };
type ImageInput = { data: string; mimeType: string };
type ImageResult = {
  id: string;
  status: string;
  prompt: string;
  revisedPrompt?: string;
  data: string;
  mimeType: string;
  savedPath?: string;
  model: string;
  outputFormat: ImageFormat;
};

declare global {
  var __piBetterGptFastStatus: "fast" | "fast requested" | undefined;
  var __piRequestFooterRender: (() => void) | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function currentModelKey(ctx: ExtensionContext): string | undefined {
  return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
}

function fastModels(): Set<string> {
  const custom = process.env.PI_FAST_MODELS?.split(",").map((s) => s.trim()).filter(Boolean);
  return custom?.length ? new Set(custom) : DEFAULT_FAST_MODELS;
}

function supportsFast(ctx: ExtensionContext): boolean {
  const key = currentModelKey(ctx);
  return key ? fastModels().has(key) : false;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function accountIdFromJwt(token: string): string | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const parsed = JSON.parse(decodeBase64Url(payload));
    const auth = parsed?.["https://api.openai.com/auth"];
    return typeof auth?.chatgpt_account_id === "string" ? auth.chatgpt_account_id : undefined;
  } catch {
    return undefined;
  }
}

function parseCredentialString(raw?: string): Credentials | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    const accessToken = parsed?.access || parsed?.token;
    const accountId = parsed?.accountId || parsed?.account_id;
    if (typeof accessToken === "string" && typeof accountId === "string") {
      return { accessToken: accessToken.trim(), accountId: accountId.trim() };
    }
  } catch {
    // Plain bearer token is fine if it contains the account id in the JWT.
  }
  const accountId = accountIdFromJwt(value);
  return accountId ? { accessToken: value, accountId } : undefined;
}

function readCodexAuth(): Credentials | undefined {
  try {
    const auth = JSON.parse(readFileSync(AUTH_FILE, "utf8"));
    const entry = auth?.["openai-codex"];
    if (entry?.type !== "oauth") return undefined;
    const accessToken = entry.access?.trim();
    const accountId = (entry.accountId || entry.account_id)?.trim();
    return accessToken && accountId ? { accessToken, accountId } : undefined;
  } catch {
    return undefined;
  }
}

async function getCredentials(ctx: ExtensionContext): Promise<Credentials> {
  const registryToken = await ctx.modelRegistry.getApiKeyForProvider("openai-codex").catch(() => undefined);
  const registryCredentials = parseCredentialString(registryToken);
  const credentials = registryCredentials || readCodexAuth();
  if (!credentials) throw new Error("Missing openai-codex OAuth credentials. Run /login openai-codex.");
  return credentials;
}

function mimeForPath(path: string, fallback: ImageFormat = "png"): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return fallback === "jpeg" ? "image/jpeg" : fallback === "webp" ? "image/webp" : "image/png";
}

async function readImageInputs(paths: string[] | undefined, cwd: string): Promise<ImageInput[]> {
  const inputs: ImageInput[] = [];
  for (const raw of paths || []) {
    const path = isAbsolute(raw) ? raw : resolve(cwd, raw);
    inputs.push({ data: (await readFile(path)).toString("base64"), mimeType: mimeForPath(path) });
  }
  return inputs;
}

function resolveModel(params: ImageParams, ctx: ExtensionContext): string {
  if (params.model?.trim()) return params.model.trim().split("/").pop() || params.model.trim();
  return ctx.model?.provider === "openai-codex" ? ctx.model.id : DEFAULT_IMAGE_MODEL;
}

function buildImageRequest(params: ImageParams, model: string, images: ImageInput[], outputFormat: ImageFormat) {
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: params.prompt }];
  for (const image of images) {
    content.push({ type: "input_image", detail: "auto", image_url: `data:${image.mimeType};base64,${image.data}` });
  }
  const tool: Record<string, unknown> = { type: "image_generation", output_format: outputFormat };
  if (params.action && params.action !== "auto") tool.action = params.action;
  return {
    model,
    instructions: "",
    input: [{ role: "user", content }],
    tools: [tool],
    tool_choice: { type: "image_generation" },
    parallel_tool_calls: false,
    store: false,
    stream: true,
    include: [],
    client_metadata: { "x-codex-installation-id": "pi-better-gpt" },
  };
}

function dataUrlParts(value: string, fallbackMimeType: string): { data: string; mimeType: string } {
  const match = value.match(/^data:([^;,]+);base64,(.*)$/s);
  return match ? { mimeType: match[1] || fallbackMimeType, data: match[2].trim() } : { data: value.trim(), mimeType: fallbackMimeType };
}

function extractImage(event: unknown, fallbackMimeType: string): Omit<ImageResult, "prompt" | "savedPath" | "model" | "outputFormat"> | undefined {
  if (!isRecord(event)) return undefined;
  const item = isRecord(event.item) ? event.item : event;
  if (item.type === "image_generation_call") {
    const raw = typeof item.result === "string" && item.result.trim() ? item.result : typeof item.b64_json === "string" ? item.b64_json : undefined;
    if (!raw) return undefined;
    const { data, mimeType } = dataUrlParts(raw, fallbackMimeType);
    return {
      id: typeof item.id === "string" ? item.id : `ig_${randomUUID().slice(0, 8)}`,
      status: typeof item.status === "string" ? item.status : "completed",
      revisedPrompt: typeof item.revised_prompt === "string" ? item.revised_prompt : undefined,
      data,
      mimeType,
    };
  }
  const partial = typeof event.partial_image_b64 === "string" ? event.partial_image_b64 : typeof event.b64_json === "string" ? event.b64_json : undefined;
  if (partial?.trim()) {
    const { data, mimeType } = dataUrlParts(partial, fallbackMimeType);
    return { id: `ig_${randomUUID().slice(0, 8)}`, status: "completed", data, mimeType };
  }
  return undefined;
}

async function parseSseForImage(response: Response, fallbackMimeType: string, signal?: AbortSignal) {
  if (!response.body) throw new Error("No response body from image request.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastImage: ReturnType<typeof extractImage>;
  try {
    while (true) {
      if (signal?.aborted) throw new Error("Image request cancelled.");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = chunk.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n").trim();
        if (data && data !== "[DONE]") {
          let event: any;
          try {
            event = JSON.parse(data);
          } catch {
            event = undefined;
          }
          const image = extractImage(event, fallbackMimeType);
          if (image?.data) {
            lastImage = image;
            if (image.status === "completed") return image;
          }
          if (event?.type === "response.failed") throw new Error(event.response?.error?.message || "Image request failed.");
          if (event?.type === "error") throw new Error(event.message || "Image request failed.");
        }
        idx = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (lastImage) return lastImage;
  throw new Error("No image result returned.");
}

function extensionForFormat(format: ImageFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

async function saveImage(data: string, id: string, format: ImageFormat, cwd: string, saveDir?: string): Promise<string> {
  const dir = saveDir ? (isAbsolute(saveDir) ? saveDir : resolve(cwd, saveDir)) : join(cwd, ".pi", "generated-images");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const path = join(dir, `image-${timestamp}-${safeId}.${extensionForFormat(format)}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path, Buffer.from(data, "base64"));
  return path;
}

function displayPath(path: string): string {
  const home = homedir();
  const homePrefix = home.endsWith(sep) ? home : `${home}${sep}`;
  return path.startsWith(homePrefix) ? `~/${path.slice(homePrefix.length)}` : path;
}

async function generateImage(params: ImageParams, ctx: ExtensionContext, requestSignal?: AbortSignal): Promise<ImageResult> {
  const cwd = ctx.cwd || process.cwd();
  const credentials = await getCredentials(ctx);
  const model = resolveModel(params, ctx);
  const outputFormat = params.outputFormat || "png";
  const images = await readImageInputs(params.images, cwd);
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(CODEX_RESPONSES_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.accessToken}`,
      "chatgpt-account-id": credentials.accountId,
      "OpenAI-Beta": "responses=experimental",
      accept: "text/event-stream",
      "content-type": "application/json",
      originator: "codex_cli_rs",
      "User-Agent": "codex_cli_rs/0.0.0 (pi-better-gpt)",
    },
    body: JSON.stringify(buildImageRequest(params, model, images, outputFormat)),
    signal,
  });
  if (!response.ok) throw new Error(`Image request failed (${response.status}): ${await response.text().catch(() => response.statusText)}`);
  const parsed = await parseSseForImage(response, mimeForPath(`image.${outputFormat}`, outputFormat), signal);
  const savedPath = params.save === false ? undefined : await saveImage(parsed.data, parsed.id, outputFormat, cwd, params.saveDir);
  return { ...parsed, prompt: params.prompt, savedPath, model, outputFormat };
}

function resultText(result: ImageResult): string {
  return [
    `Generated image via openai-codex/${result.model}.`,
    `Prompt: ${result.prompt}`,
    result.revisedPrompt ? `Revised prompt: ${result.revisedPrompt}` : undefined,
    result.savedPath ? `Saved: ${displayPath(result.savedPath)}` : undefined,
  ].filter(Boolean).join("\n");
}

export default function (pi: ExtensionAPI) {
  let fastDesired = false;

  function fastActive(ctx: ExtensionContext): boolean {
    return fastDesired && supportsFast(ctx);
  }

  function updateFastStatus(ctx: ExtensionContext): void {
    globalThis.__piBetterGptFastStatus = fastActive(ctx) ? "fast" : fastDesired ? "fast requested" : undefined;
    ctx.ui.setStatus(STATUS_KEY, undefined);
    globalThis.__piRequestFooterRender?.();
  }

  pi.registerMessageRenderer("better-gpt-image", (message: any, _options: any, theme: any) => {
    const result = message.details as ImageResult | undefined;
    const text = result
      ? resultText(result)
      : Array.isArray(message.content)
        ? message.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n")
        : String(message.content || "");
    const image = result?.data
      ? { data: result.data, mimeType: result.mimeType, savedPath: result.savedPath }
      : Array.isArray(message.content)
        ? message.content.find((p: any) => p.type === "image" && p.data && p.mimeType)
        : undefined;
    const container = new Container();
    const box = new Box(1, 1, (line: string) => theme.bg("customMessageBg", line));
    box.addChild(new Text(`${theme.fg("accent", theme.bold("[image]"))}\n\n${text}`, 0, 0));
    if (image) {
      box.addChild(new Image(image.data, image.mimeType, { fallbackColor: (line: string) => theme.fg("dim", line) }, { maxWidthCells: 80, maxHeightCells: 24, filename: image.savedPath }));
    }
    container.addChild(box);
    return container;
  });

  pi.registerCommand("fast", {
    description: "Toggle OpenAI fast mode (service_tier=priority)",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (!arg) fastDesired = !fastDesired;
      else if (["on", "true", "1", "enable", "enabled"].includes(arg)) fastDesired = true;
      else if (["off", "false", "0", "disable", "disabled"].includes(arg)) fastDesired = false;
      else if (arg !== "status") return ctx.ui.notify("Usage: /fast [on|off|status]", "error");
      updateFastStatus(ctx);
      ctx.ui.notify(fastActive(ctx) ? `Fast mode on for ${currentModelKey(ctx)}.` : fastDesired ? `Fast requested, but ${currentModelKey(ctx) || "current model"} is not in PI_FAST_MODELS.` : "Fast mode off.", "info");
    },
  });

  pi.registerCommand("image", {
    description: "Generate an image with OpenAI Codex image generation",
    handler: async (args, ctx) => {
      const prompt = args.trim();
      if (!prompt) return ctx.ui.notify("Usage: /image <prompt>", "error");
      ctx.ui.notify("Requesting image...", "info");
      try {
        const result = await generateImage({ prompt }, ctx);
        pi.sendMessage({
          customType: "better-gpt-image",
          content: [{ type: "text", text: resultText(result) }, { type: "image", data: result.data, mimeType: result.mimeType }],
          display: true,
          details: result,
        });
      } catch (error) {
        ctx.ui.notify(`Image failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.registerTool({
    name: "image",
    label: "Image",
    description: "Generate or edit images through OpenAI Codex subscription auth using the hosted image_generation tool.",
    promptSnippet: "Generate or edit raster images via OpenAI Codex image_generation.",
    promptGuidelines: [
      "Use image when the user asks to generate or edit a raster image, photo, illustration, mockup, texture, sprite, or bitmap asset.",
      "Pass the user's image prompt verbatim unless they explicitly ask you to refine it.",
      "Use image with local paths in images when the user provides reference or edit images.",
    ],
    parameters: ImageParamsSchema,
    async execute(_toolCallId, params: ImageParams, signal, onUpdate, ctx) {
      const model = resolveModel(params, ctx);
      onUpdate?.({ content: [{ type: "text", text: `Requesting image via openai-codex/${model}...` }], details: undefined });
      const result = await generateImage(params, ctx, signal);
      return {
        content: [{ type: "text", text: resultText(result) }, { type: "image", data: result.data, mimeType: result.mimeType }],
        details: result,
      };
    },
  });

  pi.on("session_start", (_event, ctx) => updateFastStatus(ctx));
  pi.on("model_select", (_event, ctx) => updateFastStatus(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    globalThis.__piBetterGptFastStatus = undefined;
    ctx.ui.setStatus(STATUS_KEY, undefined);
    globalThis.__piRequestFooterRender?.();
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!fastActive(ctx) || !isRecord(event.payload)) return;
    return { ...event.payload, service_tier: SERVICE_TIER };
  });
}
