/**
 * Full-surface smoke test: every registered MCP tool plus the UI resource,
 * driven through a real Client <-> Server pair in fake-data mode.
 *
 * export-tool.test.ts covers export_basic_report in depth; this file ensures the
 * *other* twelve tools and the UI resource all respond successfully with the
 * expected result shape, so a broken fetch/format/dispatch path is caught even
 * for the thin wrapper tools.
 *
 * Run with: npm test
 */

// Serve built-in fixtures (no real Halo API / Auth0).
process.env.HALO_FAKE_DATA = "1";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createServer } from "../../server.ts";

// The UI resource serves the built dashboard (dist/mcp-app.html). In a fresh
// source checkout that artifact may not exist yet — build it once so the
// resource test is self-sufficient (CI's `npm run build` makes this a no-op).
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
if (!existsSync(path.join(PKG_ROOT, "dist", "mcp-app.html"))) {
  execFileSync("npm", ["run", "build:ui"], { cwd: PKG_ROOT, stdio: "ignore" });
}

const FIXTURE_ID = "fixture_veliro_q1";
const RESOURCE_URI = "ui://halo/mcp-app.html";

// reportId-driven visualization tools → expected structuredContent.kind
const PER_REPORT_TOOLS: ReadonlyArray<[string, string]> = [
  ["show_report_summary", "report_summary"],
  ["show_stacked_incremental_reach", "stacked_incremental"],
  ["show_venn_overlap", "venn_overlap"],
  ["show_frequency_distribution", "frequency_distribution"],
  ["show_publisher_reach_chart", "publisher_reach_chart"],
  ["show_publisher_table", "publisher_table"],
  ["show_weekly_trends", "weekly_trends"],
];

// No-arg tools that aggregate across all SUCCEEDED reports.
const CROSS_TOOLS: ReadonlyArray<[string, string]> = [
  ["show_cross_campaign_frequency", "cross_campaign_frequency"],
  ["show_cross_campaign_reach", "cross_campaign_reach"],
];

// Table tools that return a markdown text result.
const LIST_TOOLS = ["list_basic_reports", "list_event_groups", "list_reporting_sets"];

const ALL_TOOL_NAMES = [
  ...PER_REPORT_TOOLS.map(([n]) => n),
  ...CROSS_TOOLS.map(([n]) => n),
  ...LIST_TOOLS,
  "export_basic_report",
];

async function connectedClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(res: CallToolResult): string {
  const t = res.content.find((c) => c.type === "text") as { text: string } | undefined;
  return t?.text ?? "";
}

test("listTools advertises the full tool surface", async () => {
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));
    for (const expected of ALL_TOOL_NAMES) {
      assert.ok(names.has(expected), `tool ${expected} is not advertised`);
    }
    assert.equal(names.size, ALL_TOOL_NAMES.length, `unexpected tool count: ${[...names].join(", ")}`);
  } finally {
    await client.close();
  }
});

for (const [name, kind] of PER_REPORT_TOOLS) {
  test(`${name} returns a ${kind} payload`, async () => {
    const client = await connectedClient();
    try {
      const res = (await client.callTool({ name, arguments: { reportId: FIXTURE_ID } })) as CallToolResult;
      assert.notEqual(res.isError, true, `${name} errored: ${textOf(res)}`);
      const sc = res.structuredContent as { kind?: string; report?: unknown } | undefined;
      assert.ok(sc, `${name}: no structuredContent`);
      assert.equal(sc!.kind, kind, `${name}: wrong kind`);
      assert.ok(sc!.report, `${name}: missing report payload`);
    } finally {
      await client.close();
    }
  });
}

for (const [name, kind] of CROSS_TOOLS) {
  test(`${name} returns a ${kind} payload across reports`, async () => {
    const client = await connectedClient();
    try {
      const res = (await client.callTool({ name, arguments: {} })) as CallToolResult;
      assert.notEqual(res.isError, true, `${name} errored: ${textOf(res)}`);
      const sc = res.structuredContent as { kind?: string; reports?: unknown[] } | undefined;
      assert.ok(sc, `${name}: no structuredContent`);
      assert.equal(sc!.kind, kind, `${name}: wrong kind`);
      assert.ok(Array.isArray(sc!.reports) && sc!.reports.length >= 1, `${name}: expected >=1 report`);
    } finally {
      await client.close();
    }
  });
}

for (const name of LIST_TOOLS) {
  test(`${name} returns a non-empty table`, async () => {
    const client = await connectedClient();
    try {
      const res = (await client.callTool({ name, arguments: {} })) as CallToolResult;
      assert.notEqual(res.isError, true, `${name} errored: ${textOf(res)}`);
      assert.ok(textOf(res).length > 0, `${name}: empty text result`);
    } finally {
      await client.close();
    }
  });
}

test("the UI resource serves the dashboard HTML", async () => {
  const client = await connectedClient();
  try {
    const res = (await client.readResource({ uri: RESOURCE_URI })) as ReadResourceResult;
    const first = res.contents[0] as { text?: string } | undefined;
    assert.ok(first?.text, "no resource contents");
    assert.match(first!.text!, /<\/html>|<div id="root">/, "resource is not the dashboard HTML");
  } finally {
    await client.close();
  }
});
