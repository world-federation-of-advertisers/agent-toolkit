import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  type BasicReportSummary,
  type EventGroup,
  type ReportingSet,
  getBasicReport,
  listBasicReports,
  listEventGroups,
  listReportingSets,
  loadHaloConfig,
} from "./lib/halo-client.ts";
import { generatePptxBuffer } from "./lib/halo-export-pptx.ts";

// Resolve mcp-app.html regardless of whether this runs from source (tsx) or
// compiled. The depths differ: source runs as <root>/server.ts (UI at
// <root>/dist/mcp-app.html), while the compiled bundle runs as
// <root>/dist/server/main.mjs (UI at <root>/dist/mcp-app.html, i.e. ../). Try
// both candidates and use whichever exists.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML_CANDIDATES = [
  path.join(HERE, "dist", "mcp-app.html"), // source: <root>/dist/mcp-app.html
  path.join(HERE, "..", "mcp-app.html"), // compiled: dist/server/../mcp-app.html
];

async function resolveHtmlPath(): Promise<string> {
  for (const candidate of HTML_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    `mcp-app.html not found. Looked in:\n  ${HTML_CANDIDATES.join("\n  ")}`,
  );
}

const RESOURCE_URI = "ui://halo/mcp-app.html";

function jsonResult(payload: unknown, summary: string): CallToolResult {
  return {
    content: [
      // Compact text summary for non-UI / model context.
      { type: "text", text: summary },
      // Structured JSON for the UI to consume via app.ontoolresult.
      {
        type: "resource",
        resource: {
          uri: `data:application/json,${encodeURIComponent(JSON.stringify(payload))}`,
          mimeType: "application/json",
          text: JSON.stringify(payload),
        },
      },
    ],
    structuredContent: payload as Record<string, unknown>,
  };
}

function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `Halo API error: ${message}` }],
  };
}

// Text-only result for list tools: model + chat both render the markdown table;
// structuredContent shadows it as raw JSON for programmatic callers.
function textTableResult(
  markdown: string,
  structured: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{ type: "text", text: markdown }],
    structuredContent: structured,
  };
}

// Halo titles and display names are consortium-supplied free text. Escape
// pipes and newlines so they can't break the markdown table layout or smuggle
// extra rows.
function mdCell(v: string | undefined | null): string {
  if (v == null) return "—";
  return String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim() || "—";
}

function shortDay(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : "—";
}

function bareId(name: string | undefined): string {
  if (!name) return "—";
  return name.split("/").pop() ?? name;
}

function formatBasicReportsMarkdown(reports: BasicReportSummary[]): string {
  if (reports.length === 0) return "No basic reports found.";
  const succeeded = reports.filter((r) => r.state === "SUCCEEDED").length;
  const header = "| ID | Title | Campaign Group | Period | State | Created |";
  const sep = "|---|---|---|---|---|---|";
  const rows = reports.map((r) => {
    const period =
      r.reportingInterval?.reportStart && r.reportingInterval?.reportEnd
        ? `${r.reportingInterval.reportStart} → ${r.reportingInterval.reportEnd}`
        : "—";
    return `| \`${mdCell(bareId(r.name))}\` | ${mdCell(r.title)} | ${mdCell(
      r.campaignGroupDisplayName,
    )} | ${mdCell(period)} | ${mdCell(r.state)} | ${mdCell(shortDay(r.createTime))} |`;
  });
  return [
    `**${reports.length} basic report(s)** — ${succeeded} SUCCEEDED.`,
    "",
    header,
    sep,
    ...rows,
  ].join("\n");
}

function formatEventGroupsMarkdown(groups: EventGroup[]): string {
  if (groups.length === 0) return "No event groups found.";
  const publishers = new Set(
    groups.map((g) => g.cmmsDataProvider).filter((x): x is string => !!x),
  );
  const header = "| ID | Data Provider | Media Types | Availability |";
  const sep = "|---|---|---|---|";
  const rows = groups.map((g) => {
    const avail =
      g.dataAvailabilityInterval?.startTime && g.dataAvailabilityInterval?.endTime
        ? `${shortDay(g.dataAvailabilityInterval.startTime)} → ${shortDay(g.dataAvailabilityInterval.endTime)}`
        : "—";
    return `| \`${mdCell(bareId(g.name))}\` | ${mdCell(g.cmmsDataProvider)} | ${mdCell(
      g.mediaTypes?.join(", "),
    )} | ${mdCell(avail)} |`;
  });
  return [
    `**${groups.length} event group(s)** across ${publishers.size} publisher(s).`,
    "",
    header,
    sep,
    ...rows,
  ].join("\n");
}

function formatReportingSetsMarkdown(sets: ReportingSet[]): string {
  if (sets.length === 0) return "No reporting sets found.";
  const usable = sets.filter((s) => s.campaignGroup).length;
  const header = "| Display Name | ID | Type |";
  const sep = "|---|---|---|";
  const ordered = [...sets.filter((s) => s.campaignGroup), ...sets.filter((s) => !s.campaignGroup)];
  const rows = ordered.map(
    (s) =>
      `| ${mdCell(s.displayName)} | \`${mdCell(bareId(s.name))}\` | ${
        s.campaignGroup ? "Campaign Group" : "Other"
      } |`,
  );
  return [
    `**${sets.length} reporting set(s)** — ${usable} usable as campaign groups.`,
    "",
    header,
    sep,
    ...rows,
  ].join("\n");
}


function safeIdSegment(s: string): string {
  return s.replace(/^basicReports\//, "").replace(/[^A-Za-z0-9_-]/g, "_");
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "Halo Reports",
    version: "0.1.0",
  });

  server.registerTool(
    "list_basic_reports",
    {
      title: "List Halo Basic Reports",
      description:
        "List recent Halo Basic Reports in the configured measurement consumer. Returns a markdown table of id, title, campaign group, period, state, created date.",
      inputSchema: {
        pageSize: z.number().int().min(1).max(100).optional().describe("Per-page size, default 25"),
        maxPages: z.number().int().min(1).max(20).optional().describe("Max pages to walk, default 4"),
      },
    },
    async ({ pageSize, maxPages }): Promise<CallToolResult> => {
      try {
        const cfg = loadHaloConfig();
        const reports = await listBasicReports(cfg, { pageSize, maxPages });
        return textTableResult(formatBasicReportsMarkdown(reports), { reports });
      } catch (e) {
        return errorResult(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // ------------------------------------------------------------------------
  // Visualization tools — one per chart/view. All take a reportId and render
  // a single visualization inside the chat. Backed by the in-memory report
  // cache in halo-client.ts so calling several in one turn fetches once.
  // ------------------------------------------------------------------------
  const VIZ_TOOLS: ReadonlyArray<{
    name: string;
    title: string;
    description: string;
    kind: string;
  }> = [
    {
      name: "show_report_summary",
      title: "Show Halo Report Summary",
      kind: "report_summary",
      description:
        "Render a Halo Basic Report's summary view: headline KPIs (net reach, impressions, average frequency, GRPs), publisher list, and a one-paragraph narrative. Use as the default entry point when the user opens a report or asks for an overview.",
    },
    {
      name: "show_stacked_incremental_reach",
      title: "Show Stacked Incremental Reach",
      kind: "stacked_incremental",
      description:
        "Render the stacked-incremental-reach chart for a Halo Basic Report: each publisher's contribution to total net reach, ordered by anchor. Use when the user asks about cross-publisher reach contribution, anchor publisher, or incremental lift from added publishers.",
    },
    {
      name: "show_venn_overlap",
      title: "Show Cross-Publisher Overlap (Venn)",
      kind: "venn_overlap",
      description:
        "Render a proportional-area Venn diagram for the top two publishers in a Halo Basic Report. Use when the user asks about audience duplication, overlap, deduplication, or unique-vs-shared reach between two publishers. Requires at least two publishers with reach data.",
    },
    {
      name: "show_frequency_distribution",
      title: "Show Frequency Distribution (k+ reach)",
      kind: "frequency_distribution",
      description:
        "Render the k+ reach histogram for a Halo Basic Report: how many people were reached at each frequency threshold (1+, 2+, 3+, …). Use when the user asks about effective frequency, frequency capping, the 3+ threshold, or frequency distribution.",
    },
    {
      name: "show_publisher_reach_chart",
      title: "Show Per-Publisher Reach Chart",
      kind: "publisher_reach_chart",
      description:
        "Render a per-publisher bar chart comparing total reach vs. unique reach for each publisher in a Halo Basic Report. Use when the user wants a visual comparison of publishers' delivery without the full numeric table.",
    },
    {
      name: "show_publisher_table",
      title: "Show Per-Publisher Detail Table",
      kind: "publisher_table",
      description:
        "Render the full per-publisher metrics table for a Halo Basic Report: reach, % of universe, impressions, average frequency, and unique reach for each publisher. Use when the user wants exact numbers per publisher or a tabular breakdown.",
    },
    {
      name: "show_weekly_trends",
      title: "Show Weekly Trends",
      kind: "weekly_trends",
      description:
        "Render the weekly trends chart for a Halo Basic Report: cumulative net reach (line) and weekly impressions (bars) over the campaign window. Use when the user asks about pacing, reach growth over time, weekly delivery, or flighting.",
    },
  ];

  for (const t of VIZ_TOOLS) {
    registerAppTool(
      server,
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: {
          reportId: z
            .string()
            .min(1)
            .describe("Basic report ID, e.g. 'abc123' or 'basicReports/abc123'"),
        },
        _meta: { ui: { resourceUri: RESOURCE_URI } },
      },
      async ({ reportId }): Promise<CallToolResult> => {
        try {
          const cfg = loadHaloConfig();
          const report = await getBasicReport(cfg, reportId);
          const title = (report.title as string | undefined) ?? report.name;
          return jsonResult(
            { kind: t.kind, report },
            `Rendered ${t.kind.replace(/_/g, " ")} for "${title}" (state=${report.state ?? "?"}).`,
          );
        } catch (e) {
          return errorResult(e instanceof Error ? e.message : String(e));
        }
      },
    );
  }

  // ------------------------------------------------------------------------
  // Cross-campaign visualization tools — operate on ALL succeeded reports.
  // ------------------------------------------------------------------------

  const CROSS_TOOLS: ReadonlyArray<{
    name: string;
    title: string;
    description: string;
    kind: string;
  }> = [
    {
      name: "show_cross_campaign_frequency",
      title: "Compare Frequency Distributions Across Campaigns",
      kind: "cross_campaign_frequency",
      description:
        "Overlay the k+ reach frequency distributions from all SUCCEEDED campaigns on a single chart. Use when the user asks whether frequency patterns are consistent across campaigns, or wants to compare frequency distributions side-by-side.",
    },
    {
      name: "show_cross_campaign_reach",
      title: "Compare Publisher Reach Across Campaigns",
      kind: "cross_campaign_reach",
      description:
        "Show per-publisher reach across all SUCCEEDED campaigns as a grouped bar chart. Use when the user asks which publishers deliver the most reach across their account, or wants to compare publisher performance across campaigns.",
    },
  ];

  for (const t of CROSS_TOOLS) {
    registerAppTool(
      server,
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: {},
        _meta: { ui: { resourceUri: RESOURCE_URI } },
      },
      async (): Promise<CallToolResult> => {
        try {
          const cfg = loadHaloConfig();
          const summaries = await listBasicReports(cfg, {});
          const succeeded = summaries.filter((s) => s.state === "SUCCEEDED");
          if (succeeded.length === 0) {
            return errorResult("No SUCCEEDED reports found.");
          }
          const reports = await Promise.all(
            succeeded.map((s) => {
              const id = (s.name as string).split("/").pop() ?? s.name;
              return getBasicReport(cfg, id);
            }),
          );
          return jsonResult(
            { kind: t.kind, reports },
            `Rendered ${t.kind.replace(/_/g, " ")} across ${reports.length} campaign(s).`,
          );
        } catch (e) {
          return errorResult(e instanceof Error ? e.message : String(e));
        }
      },
    );
  }

  server.registerTool(
    "list_event_groups",
    {
      title: "List Halo Event Groups",
      description:
        "List event groups (campaigns) in the configured measurement consumer. Returns a markdown table. Optionally filter by free-text metadata search (e.g. brand name).",
      inputSchema: {
        search: z.string().optional().describe("Optional metadata_search_query, e.g. brand name"),
        pageSize: z.number().int().min(1).max(100).optional(),
        maxPages: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ search, pageSize, maxPages }): Promise<CallToolResult> => {
      try {
        const cfg = loadHaloConfig();
        const groups = await listEventGroups(cfg, { search, pageSize, maxPages });
        return textTableResult(formatEventGroupsMarkdown(groups), { eventGroups: groups });
      } catch (e) {
        return errorResult(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "list_reporting_sets",
    {
      title: "List Halo Reporting Sets",
      description:
        "List reporting sets in the configured measurement consumer. Returns a markdown table. Only sets with `campaignGroup` populated are usable for basic reports.",
      inputSchema: {
        pageSize: z.number().int().min(1).max(100).optional(),
        maxPages: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ pageSize, maxPages }): Promise<CallToolResult> => {
      try {
        const cfg = loadHaloConfig();
        const sets = await listReportingSets(cfg, { pageSize, maxPages });
        return textTableResult(formatReportingSetsMarkdown(sets), { reportingSets: sets });
      } catch (e) {
        return errorResult(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "export_basic_report",
    {
      title: "Export Halo Basic Report",
      description:
        "Export a Halo Basic Report as a native PowerPoint deck (.pptx). Returns the file as an embedded binary resource. Charts are native PowerPoint objects.",
      inputSchema: {
        reportId: z.string().min(1).describe("Basic report ID, e.g. 'abc123' or 'basicReports/abc123'"),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ reportId }): Promise<CallToolResult> => {
      try {
        const cfg = loadHaloConfig();
        const report = await getBasicReport(cfg, reportId);
        const title = (report.title as string | undefined) ?? report.name;
        const buffer = await generatePptxBuffer(report);
        const filename = `halo_${safeIdSegment(reportId)}.pptx`;
        const blob = buffer.toString("base64");
        const meta = { kind: "pptx_export", filename, title };
        return {
          content: [
            { type: "text", text: `Generated PowerPoint deck "${title}" (${Math.round(buffer.length / 1024)} KB). The file is ready for download in the Halo Reports UI.` },
            {
              type: "resource",
              resource: {
                uri: `data:application/json,${encodeURIComponent(JSON.stringify(meta))}`,
                mimeType: "application/json",
                text: JSON.stringify(meta),
              },
            },
          ],
          structuredContent: { ...meta, blob } as Record<string, unknown>,
        };
      } catch (e) {
        return errorResult(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerAppResource(
    server,
    "Halo Reports UI",
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE, description: "Interactive UI for Halo report tools" },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(await resolveHtmlPath(), "utf-8");
      return {
        contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}
