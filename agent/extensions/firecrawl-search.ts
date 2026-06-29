import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);
const FIRECRAWL_USAGE_TTL_MS = 90_000;

type FirecrawlUsageSnapshot = {
  remainingCredits?: number;
  planCredits?: number;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  creditsUsed?: number;
  expiresAt: number;
};

declare global {
  // Shared with minimal-footer.ts.
  var __piFirecrawlUsage: FirecrawlUsageSnapshot | undefined;
  var __piRequestFooterRender: (() => void) | undefined;
}

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function runFirecrawl(args: string[], timeout = 60_000) {
  const { stdout, stderr } = await execFileAsync("firecrawl", args, {
    timeout,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env,
  });

  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
}

function tryParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function fetchCreditUsage(): Promise<Omit<FirecrawlUsageSnapshot, "expiresAt" | "creditsUsed">> {
  try {
    const output = await runFirecrawl(["credit-usage", "--json"], 20_000);
    const json = tryParseJson(output);
    const data = json?.data;
    return {
      remainingCredits: typeof data?.remainingCredits === "number" ? data.remainingCredits : undefined,
      planCredits: typeof data?.planCredits === "number" ? data.planCredits : undefined,
      billingPeriodStart: typeof data?.billingPeriodStart === "string" ? data.billingPeriodStart : undefined,
      billingPeriodEnd: typeof data?.billingPeriodEnd === "string" ? data.billingPeriodEnd : undefined,
    };
  } catch {
    return {};
  }
}

function publishFirecrawlUsage(snapshot: Omit<FirecrawlUsageSnapshot, "expiresAt">) {
  globalThis.__piFirecrawlUsage = { ...snapshot, expiresAt: Date.now() + FIRECRAWL_USAGE_TTL_MS };
  globalThis.__piRequestFooterRender?.();
  setTimeout(() => globalThis.__piRequestFooterRender?.(), FIRECRAWL_USAGE_TTL_MS + 100).unref?.();
}

function resultText(result: any): string {
  const block = result?.content?.find?.((item: any) => item?.type === "text");
  return typeof block?.text === "string" ? block.text : "";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function textBytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function firecrawlUsageSuffix() {
  const snapshot = globalThis.__piFirecrawlUsage;
  if (!snapshot || snapshot.expiresAt <= Date.now()) return "";
  if (typeof snapshot.creditsUsed === "number") return ` · credits used ${Math.round(snapshot.creditsUsed)}`;
  if (typeof snapshot.remainingCredits === "number") return ` · credits left ${Math.round(snapshot.remainingCredits)}`;
  return "";
}

function searchResultCount(details: any): number | undefined {
  const data = details?.data;
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data?.web)) return data.web.length;
  if (Array.isArray(data?.results)) return data.results.length;
  if (Array.isArray(details?.results)) return details.results.length;
  return undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "search",
    label: "Search Web",
    description:
      "Search the web with the authenticated Firecrawl CLI. Can optionally scrape result pages and return markdown content.",
    promptSnippet: "Search the web with Firecrawl for current information.",
    promptGuidelines: [
      "Use search when the user asks for current web information, discovery, public repositories, documentation, news, or sources beyond the local workspace.",
      "Use scrape when the user provides a URL or when full page content is needed from a search result.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "The web search query." }),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results. Defaults to 5.", minimum: 1, maximum: 20 })),
      source: Type.Optional(StringEnum(["web", "news", "images"] as const)),
      scrapeResults: Type.Optional(Type.Boolean({ description: "Whether to scrape result pages and include markdown. Defaults to false." })),
      tbs: Type.Optional(Type.String({ description: "Optional time filter, e.g. qdr:d, qdr:w, qdr:m, qdr:y." })),
    }),
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Searching Firecrawl..."), 0, 0);
      if (result?.isError || result?.details?.error) {
        return new Text(theme.fg("error", result?.details?.error ?? resultText(result) ?? "Firecrawl search failed"), 0, 0);
      }

      const text = resultText(result);
      const count = searchResultCount(result?.details);
      const parts = [
        theme.fg("success", "✓ Search Web"),
        count === undefined ? "results returned" : `${count} result${count === 1 ? "" : "s"}`,
        formatBytes(textBytes(text)),
      ];
      return new Text(`${parts.join(" · ")}${firecrawlUsageSuffix()} · full output sent to model`, 0, 0);
    },
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        onUpdate?.({ content: [{ type: "text", text: `Searching Firecrawl for: ${params.query}` }] });

        const args = [
          "search",
          params.query,
          "--json",
          "--limit",
          String(params.limit ?? 5),
          "--sources",
          params.source ?? "web",
        ];

        if (params.scrapeResults) {
          args.push("--scrape", "--scrape-formats", "markdown", "--only-main-content");
        }
        if (params.tbs) args.push("--tbs", params.tbs);

        const output = await runFirecrawl(args, 90_000);
        if (signal?.aborted) throw new Error("Search cancelled");

        const json = tryParseJson(output);
        const creditsUsed = typeof json?.creditsUsed === "number" ? json.creditsUsed : undefined;
        void fetchCreditUsage().then((usage) => publishFirecrawlUsage({ creditsUsed, ...usage }));
        return {
          content: [{ type: "text", text: json ? JSON.stringify(json, null, 2) : output }],
          details: json ?? { output },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Firecrawl search failed: ${asErrorMessage(error)}` }],
          details: { error: asErrorMessage(error) },
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "scrape",
    label: "Scrape Page",
    description: "Fetch a URL's readable content as markdown with the authenticated Firecrawl CLI.",
    promptSnippet: "Fetch a URL's page content as markdown with Firecrawl.",
    promptGuidelines: [
      "Use scrape when the user provides a URL and asks to read, summarize, inspect, or use its contents.",
      "Prefer scrape for web pages because it returns cleaned markdown suitable for agent context.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "The URL to fetch." }),
      onlyMainContent: Type.Optional(Type.Boolean({ description: "Return only main content. Defaults to true." })),
      waitFor: Type.Optional(Type.Number({ description: "Milliseconds to wait before capturing content." })),
      format: Type.Optional(StringEnum(["markdown", "summary", "links", "html"] as const)),
    }),
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Scraping with Firecrawl..."), 0, 0);
      if (result?.isError || result?.details?.error) {
        return new Text(theme.fg("error", result?.details?.error ?? resultText(result) ?? "Firecrawl scrape failed"), 0, 0);
      }

      const text = resultText(result);
      const url = result?.details?.url ? ` · ${result.details.url}` : "";
      const format = result?.details?.format ? ` · ${result.details.format}` : "";
      return new Text(
        `${theme.fg("success", "✓ Scrape Page")}${url}${format} · ${formatBytes(textBytes(text))}${firecrawlUsageSuffix()} · full output sent to model`,
        0,
        0,
      );
    },
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        onUpdate?.({ content: [{ type: "text", text: `Scraping with Firecrawl: ${params.url}` }] });

        const format = params.format ?? "markdown";
        const args = ["scrape", params.url, "--format", format];
        if (params.onlyMainContent ?? true) args.push("--only-main-content");
        if (params.waitFor) args.push("--wait-for", String(params.waitFor));

        const output = await runFirecrawl(args, 90_000);
        if (signal?.aborted) throw new Error("Scrape cancelled");

        void fetchCreditUsage().then((usage) => publishFirecrawlUsage(usage));
        return {
          content: [{ type: "text", text: output || "No content returned." }],
          details: { url: params.url, format },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Firecrawl scrape failed: ${asErrorMessage(error)}` }],
          details: { error: asErrorMessage(error) },
          isError: true,
        };
      }
    },
  });
}
