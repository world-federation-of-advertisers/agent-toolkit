/**
 * End-to-end tests for the `export_basic_report` MCP tool.
 *
 * Unlike export.test.ts (which exercises the PPTX generator library directly),
 * this drives the tool through a real MCP Client <-> Server pair over an
 * in-memory transport. It exercises the full tool-handler path: registration,
 * input-schema validation, fixture lookup (fake-data mode is hardcoded on, so
 * no network/Auth0), buffer generation, and the CallToolResult shape the host
 * consumes — text content, the embedded resource, and the structuredContent
 * carrying the base64 deck.
 *
 * Run with: npm test
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createServer } from "../../server.ts";

// IDs registered by FIXTURE_REPORTS in lib/halo-fixtures.ts.
const FIXTURE_IDS = ["fixture_veliro_q1", "fixture_pellura_q1", "fixture_cobari_q1"];

/** Spin up a connected client backed by a fresh server over in-memory pipes. */
async function connectedClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

test("export_basic_report is advertised with a reportId input", async () => {
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "export_basic_report");
    assert.ok(tool, "export_basic_report tool not registered");
    assert.match(tool!.description ?? "", /PowerPoint|\.pptx/i);
    assert.ok(
      tool!.inputSchema?.properties?.reportId,
      "tool input schema is missing reportId",
    );
  } finally {
    await client.close();
  }
});

for (const reportId of FIXTURE_IDS) {
  test(`export_basic_report returns a downloadable deck for ${reportId}`, async () => {
    const client = await connectedClient();
    try {
      const res = (await client.callTool({
        name: "export_basic_report",
        arguments: { reportId },
      })) as CallToolResult;

      assert.notEqual(res.isError, true, `tool reported an error for ${reportId}`);

      // 1) Human-readable confirmation text, sized in KB.
      const textPart = res.content.find((c) => c.type === "text");
      assert.ok(textPart, "no text content in result");
      assert.match((textPart as { text: string }).text, /KB/);

      // 2) An embedded resource describing the export.
      const resourcePart = res.content.find((c) => c.type === "resource");
      assert.ok(resourcePart, "no resource content in result");

      // 3) structuredContent carries the metadata + base64 deck the host
      //    turns into an in-app download.
      const sc = res.structuredContent as
        | { kind?: string; filename?: string; title?: string; blob?: string }
        | undefined;
      assert.ok(sc, "no structuredContent in result");
      assert.equal(sc!.kind, "pptx_export");
      assert.match(sc!.filename ?? "", /^halo_.*\.pptx$/);
      assert.ok(sc!.title && sc!.title.length > 0, "missing title");
      assert.ok(sc!.blob && sc!.blob.length > 1000, "blob missing or too small");

      // 4) The blob must decode to a real PPTX: a ZIP container (PK header)
      //    holding slide parts.
      const buf = Buffer.from(sc!.blob!, "base64");
      assert.ok(buf.length > 1000, `decoded deck too small (${buf.length} bytes)`);
      assert.equal(buf[0], 0x50, "decoded deck is not a zip (byte 0 != 'P')");
      assert.equal(buf[1], 0x4b, "decoded deck is not a zip (byte 1 != 'K')");
      assert.match(
        buf.toString("binary"),
        /ppt\/slides\/slide1\.xml/,
        "deck has no slides",
      );
    } finally {
      await client.close();
    }
  });
}

test("export_basic_report errors cleanly on an unknown report", async () => {
  const client = await connectedClient();
  try {
    const res = (await client.callTool({
      name: "export_basic_report",
      arguments: { reportId: "does_not_exist_xyz" },
    })) as CallToolResult;

    assert.equal(res.isError, true, "expected an error result for unknown report");
    const textPart = res.content.find((c) => c.type === "text");
    assert.match((textPart as { text: string }).text, /unknown fake report/i);
  } finally {
    await client.close();
  }
});

test("export_basic_report rejects a missing reportId via schema validation", async () => {
  const client = await connectedClient();
  try {
    const res = (await client.callTool({
      name: "export_basic_report",
      arguments: {},
    })) as CallToolResult;

    assert.equal(res.isError, true, "missing reportId should produce an error result");
    const textPart = res.content.find((c) => c.type === "text");
    assert.match((textPart as { text: string }).text, /validation|reportId/i);
  } finally {
    await client.close();
  }
});
