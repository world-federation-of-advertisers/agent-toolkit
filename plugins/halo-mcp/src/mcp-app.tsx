/**
 * Halo Reports MCP App.
 *
 * Subscribes to tool results from the host, extracts the structured JSON payload
 * (each Halo tool returns { kind, ... }), and dispatches to the matching view.
 */
import type { App } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Component, StrictMode, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { BasicReport } from "./halo-types.ts";
import { parseReport } from "./halo-types.ts";
import {
  EmptyState,
  ErrorView,
  FrequencyDistributionView,
  PublisherReachChartView,
  PublisherTableView,
  StackedIncrementalView,
  SummaryView,
  VennOverlapView,
  WeeklyTrendsView,
} from "./views.tsx";

type ReportKind =
  | "report_summary"
  | "stacked_incremental"
  | "venn_overlap"
  | "frequency_distribution"
  | "publisher_reach_chart"
  | "publisher_table"
  | "weekly_trends";

type ToolPayload = { kind: ReportKind; report: BasicReport };

function extractPayload(result: CallToolResult): ToolPayload | { error: string } | null {
  if (result.isError) {
    const txt = result.content
      ?.filter((c) => c.type === "text")
      .map((c) => ("text" in c ? c.text : ""))
      .join("\n");
    return { error: txt || "Tool returned an error with no message." };
  }
  // 1. Prefer structuredContent (set by jsonResult).
  const structured = (result as { structuredContent?: unknown }).structuredContent;
  if (structured && typeof structured === "object") {
    return structured as ToolPayload;
  }
  // 2. Fall back to an embedded application/json resource block. Some hosts
  //    don't forward structuredContent; the resource block carries the same
  //    payload and is always delivered.
  for (const c of result.content ?? []) {
    if (c.type !== "resource") continue;
    const res = (c as { resource?: { mimeType?: string; text?: string; uri?: string } }).resource;
    if (!res) continue;
    if (res.mimeType === "application/json" && typeof res.text === "string") {
      try {
        return JSON.parse(res.text) as ToolPayload;
      } catch {
        // fall through
      }
    }
    if (typeof res.uri === "string" && res.uri.startsWith("data:application/json,")) {
      try {
        return JSON.parse(decodeURIComponent(res.uri.slice("data:application/json,".length))) as ToolPayload;
      } catch {
        // fall through
      }
    }
  }
  // 3. Last-ditch: try parsing a text block as JSON.
  const textBlock = result.content?.find((c) => c.type === "text");
  if (textBlock && "text" in textBlock) {
    try {
      return JSON.parse(textBlock.text) as ToolPayload;
    } catch {
      // not JSON — show summary as-is
    }
  }
  return null;
}

// Visible fallback for render errors — iframe devtools are unreachable in some
// hosts, so a blank canvas would otherwise hide the cause.
class Boundary extends Component<{ children: ReactNode }, { err?: Error }> {
  state: { err?: Error } = {};
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error("Boundary caught:", err); }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 24, fontFamily: "ui-monospace, monospace", fontSize: 13, background: "#fee2e2", color: "#7f1d1d", minHeight: "100vh" }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Render error</div>
          <div style={{ marginBottom: 8 }}>{this.state.err.name}: {this.state.err.message}</div>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{this.state.err.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function HaloApp() {
  const [payload, setPayload] = useState<ToolPayload | { error: string } | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "Halo Reports", version: "0.1.0" },
    capabilities: {},
    onAppCreated: (a) => {
      a.onteardown = async () => ({});
      a.ontoolresult = async (result) => {
        setPayload(extractPayload(result));
      };
      a.onerror = console.error;
    },
  });

  if (error) {
    return <ErrorView error={`SDK error: ${error.message}`} />;
  }
  if (!app) {
    return <EmptyState message="Connecting to host…" />;
  }
  if (!payload) {
    return (
      <EmptyState message="Call one of the Halo show_* tools (show_report_summary, show_stacked_incremental_reach, show_venn_overlap, show_frequency_distribution, show_publisher_reach_chart, show_publisher_table, show_weekly_trends) to render a visualization here. List tools (list_basic_reports, list_event_groups, list_reporting_sets) and export_basic_report return text — they don't render in this iframe." />
    );
  }
  if ("error" in payload) {
    return <ErrorView error={payload.error} />;
  }
  return <Dispatch payload={payload} app={app} />;
}

const VIZ_RENDERERS: Record<
  ReportKind,
  (p: { report: ReturnType<typeof parseReport>; app: App }) => ReactElement
> = {
  report_summary: SummaryView,
  stacked_incremental: StackedIncrementalView,
  venn_overlap: VennOverlapView,
  frequency_distribution: FrequencyDistributionView,
  publisher_reach_chart: PublisherReachChartView,
  publisher_table: PublisherTableView,
  weekly_trends: WeeklyTrendsView,
};

function Dispatch({ payload, app }: { payload: ToolPayload; app: App }) {
  const Render = VIZ_RENDERERS[payload.kind];
  if (!Render) {
    return <ErrorView error={`Unknown payload kind: ${JSON.stringify(payload)}`} />;
  }
  return <Render report={parseReport(payload.report)} app={app} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boundary>
      <HaloApp />
    </Boundary>
  </StrictMode>,
);
