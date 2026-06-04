/**
 * Entry point for the Halo MCP server.
 *
 *   HTTP:  npm run serve             (PORT=3001, then point a host at http://localhost:3001/mcp)
 *   stdio: npm run serve:stdio       (for hosts that prefer the stdio transport)
 */
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Request, Response } from "express";
import { createServer } from "./server.ts";

async function startStreamableHTTPServer(factory: () => McpServer): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  // Bind to loopback by default. createMcpExpressApp enables DNS-rebinding
  // protection automatically for localhost hosts; binding to a non-loopback
  // host (e.g. HOST=0.0.0.0) leaves the server open to DNS-rebinding attacks
  // unless an explicit ALLOWED_HOSTS list is supplied.
  const host = process.env.HOST ?? "127.0.0.1";
  const allowedHosts = process.env.ALLOWED_HOSTS?.split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const app = createMcpExpressApp(
    allowedHosts?.length ? { host, allowedHosts } : { host },
  );
  app.use(cors());

  // Stateless transport: a fresh server + transport per request. The JSON-RPC
  // message arrives via POST; GET/DELETE are only meaningful for session-based
  // transports, so reject them with 405 (matches the SDK stateless example).
  app.post("/mcp", async (req: Request, res: Response) => {
    const server = factory();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  const httpServer = app.listen(port, host, () => {
    console.log(`Halo MCP server listening on http://${host}:${port}/mcp`);
  });
  httpServer.on("error", (err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    httpServer.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function startStdioServer(factory: () => McpServer): Promise<void> {
  await factory().connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer(createServer);
  } else {
    await startStreamableHTTPServer(createServer);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
