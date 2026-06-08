/**
 * Halo Cross-Media Measurement API client.
 *
 * Read-only.
 * - Auth0 client_credentials grant; tokens cached on disk for ~55 min.
 * - Optional outbound proxy via HTTPS_PROXY.
 * - Pagination via nextPageToken on all LIST endpoints.
 *
 * Fake mode: when HALO_FAKE_DATA=1, the client bypasses Auth0 and HTTP
 * entirely and returns fixtures from ./halo-fixtures.ts. Used for demos
 * and offline development. No env vars required in fake mode.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProxyAgent, type Dispatcher } from "undici";
import {
  FIXTURE_EVENT_GROUPS,
  FIXTURE_REPORTING_SETS,
  FIXTURE_REPORTS,
  findFixtureReport,
} from "./halo-fixtures.ts";

const TOKEN_MAX_AGE_SECONDS = 3300; // refresh ~5 min before the 60-min expiry

export function isFakeMode(): boolean {
  const v = (process.env.HALO_FAKE_DATA ?? "").toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes";
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `Missing required env var ${name}. Set it in the environment before starting the server (or use HALO_FAKE_DATA=1 for fixtures). See plugins/halo-mcp/README.md#configuration.`,
    );
  }
  return v;
}

export interface HaloConfig {
  baseUrl: string;
  mcId: string;
  auth0Url: string;
  auth0Audience: string;
  clientId: string;
  clientSecret: string;
  tokenFile: string;
  dispatcher?: Dispatcher;
}

export function loadHaloConfig(): HaloConfig {
  if (isFakeMode()) {
    // No env vars are required in fake mode; return a stub config. None of
    // these fields are read by the fake-mode short-circuits below, but
    // returning a real-shaped object keeps the type system honest.
    return {
      baseUrl: "fake://halo",
      mcId: "measurementConsumers/demo",
      auth0Url: "fake://auth0",
      auth0Audience: "fake",
      clientId: "fake",
      clientSecret: "fake",
      tokenFile: path.join(os.tmpdir(), ".halo_token_fake"),
    };
  }
  const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  return {
    baseUrl: requiredEnv("HALO_BASE_URL").replace(/\/+$/, ""),
    mcId: requiredEnv("HALO_MC_ID"),
    auth0Url: requiredEnv("HALO_AUTH0_URL").replace(/\/+$/, ""),
    auth0Audience: requiredEnv("HALO_AUTH0_AUDIENCE"),
    clientId: requiredEnv("HALO_CLIENT_ID"),
    clientSecret: requiredEnv("HALO_CLIENT_SECRET"),
    tokenFile: process.env.HALO_TOKEN_FILE ?? path.join(os.homedir(), ".halo_token"),
    dispatcher: proxyUrl ? new ProxyAgent(proxyUrl) : undefined,
  };
}

type CachedToken = { token: string; expiresAt: number };
let inMemoryToken: CachedToken | null = null;

async function readDiskToken(file: string): Promise<CachedToken | null> {
  try {
    const stat = await fs.stat(file);
    const ageSeconds = (Date.now() - stat.mtimeMs) / 1000;
    if (ageSeconds >= TOKEN_MAX_AGE_SECONDS) return null;
    const token = (await fs.readFile(file, "utf8")).trim();
    if (!token || token === "null" || token.length < 20) return null;
    const expiresAt = stat.mtimeMs + TOKEN_MAX_AGE_SECONDS * 1000;
    return { token, expiresAt };
  } catch {
    return null;
  }
}

async function writeDiskToken(file: string, token: string): Promise<void> {
  await fs.writeFile(file, token, { mode: 0o600 });
  try { await fs.chmod(file, 0o600); } catch { /* best effort */ }
}

async function fetchNewToken(cfg: HaloConfig): Promise<string> {
  const res = await fetch(`${cfg.auth0Url}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      audience: cfg.auth0Audience,
      grant_type: "client_credentials",
    }),
    dispatcher: cfg.dispatcher,
  } as RequestInit);
  if (!res.ok) {
    throw new Error(`Auth0 token request failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { access_token?: string };
  const token = body.access_token;
  if (!token || token.length < 20) {
    throw new Error("Auth0 returned no usable access_token.");
  }
  return token;
}

export async function getToken(cfg: HaloConfig): Promise<string> {
  if (inMemoryToken && inMemoryToken.expiresAt > Date.now()) {
    return inMemoryToken.token;
  }
  const disk = await readDiskToken(cfg.tokenFile);
  if (disk) {
    inMemoryToken = disk;
    return disk.token;
  }
  const fresh = await fetchNewToken(cfg);
  inMemoryToken = { token: fresh, expiresAt: Date.now() + TOKEN_MAX_AGE_SECONDS * 1000 };
  await writeDiskToken(cfg.tokenFile, fresh);
  return fresh;
}

async function haloGet<T>(
  cfg: HaloConfig,
  pathAndQuery: string,
): Promise<T> {
  const token = await getToken(cfg);
  const url = pathAndQuery.startsWith("http")
    ? pathAndQuery
    : `${cfg.baseUrl}${pathAndQuery}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    dispatcher: cfg.dispatcher,
  } as RequestInit);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Halo GET ${url} failed: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 500)}` : ""}`,
    );
  }
  return (await res.json()) as T;
}

interface PagedResponse {
  nextPageToken?: string;
}

async function paginate<T extends PagedResponse, K extends keyof T>(
  cfg: HaloConfig,
  basePath: string,
  itemsKey: K,
  pageSize: number,
  maxPages: number,
): Promise<Array<NonNullable<T[K]> extends Array<infer U> ? U : never>> {
  const out: unknown[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const sep = basePath.includes("?") ? "&" : "?";
    const qs = `${sep}pageSize=${pageSize}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const page = await haloGet<T>(cfg, `${basePath}${qs}`);
    const items = page[itemsKey];
    if (Array.isArray(items)) out.push(...items);
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }
  return out as Array<NonNullable<T[K]> extends Array<infer U> ? U : never>;
}

// ---- Public API surface ----

export interface EventGroup {
  name: string;
  cmmsDataProvider?: string;
  cmmsMeasurementConsumer?: string;
  dataAvailabilityInterval?: { startTime?: string; endTime?: string };
  mediaTypes?: string[];
  eventGroupMetadata?: unknown;
}

export interface ReportingSet {
  name: string;
  displayName?: string;
  campaignGroup?: unknown;
  primitive?: unknown;
  composite?: unknown;
}

export interface BasicReportSummary {
  name: string;
  title?: string;
  state?: string;
  createTime?: string;
  campaignGroupDisplayName?: string;
  reportingInterval?: { reportStart?: string; reportEnd?: string };
}

export type BasicReport = BasicReportSummary & Record<string, unknown>;

export async function listEventGroups(
  cfg: HaloConfig,
  opts: { search?: string; pageSize?: number; maxPages?: number } = {},
): Promise<EventGroup[]> {
  if (isFakeMode()) {
    const q = opts.search?.toLowerCase().trim();
    const all = FIXTURE_EVENT_GROUPS as EventGroup[];
    return q ? all.filter((g) => JSON.stringify(g).toLowerCase().includes(q)) : all;
  }
  const pageSize = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 5;
  const search = opts.search?.trim();
  const filter = search
    ? `&structured_filter.metadata_search_query=${encodeURIComponent(search)}`
    : "";
  return paginate<{ eventGroups?: EventGroup[]; nextPageToken?: string }, "eventGroups">(
    cfg,
    `/v2alpha/${cfg.mcId}/eventGroups?_=1${filter}`,
    "eventGroups",
    pageSize,
    maxPages,
  );
}

export async function listReportingSets(
  cfg: HaloConfig,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<ReportingSet[]> {
  if (isFakeMode()) {
    return FIXTURE_REPORTING_SETS as ReportingSet[];
  }
  const pageSize = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 5;
  return paginate<
    { reportingSets?: ReportingSet[]; nextPageToken?: string },
    "reportingSets"
  >(
    cfg,
    `/v2alpha/${cfg.mcId}/reportingSets`,
    "reportingSets",
    pageSize,
    maxPages,
  );
}

export async function listBasicReports(
  cfg: HaloConfig,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<BasicReportSummary[]> {
  if (isFakeMode()) {
    return FIXTURE_REPORTS.map((r) => ({
      name: r.name,
      title: r.title,
      state: r.state,
      createTime: r.createTime,
      campaignGroupDisplayName: r.campaignGroupDisplayName,
      reportingInterval: r.reportingInterval as BasicReportSummary["reportingInterval"],
    }));
  }
  const pageSize = opts.pageSize ?? 5;
  const maxPages = opts.maxPages ?? 10;
  return paginate<
    { basicReports?: BasicReport[]; nextPageToken?: string },
    "basicReports"
  >(
    cfg,
    `/v2alpha/${cfg.mcId}/basicReports`,
    "basicReports",
    pageSize,
    maxPages,
  ).then((reports) =>
    reports.map((r) => ({
      name: r.name,
      title: r.title,
      state: r.state,
      createTime: r.createTime,
      campaignGroupDisplayName: r.campaignGroupDisplayName,
      reportingInterval: r.reportingInterval,
    })),
  );
}

// Short-lived in-memory cache so a chat turn that calls multiple viz tools on
// the same report doesn't fan out into N identical GETs. Keyed by mcId + bare id.
const REPORT_CACHE_TTL_MS = 60_000;
const reportCache = new Map<string, { report: BasicReport; expiresAt: number }>();

export async function getBasicReport(
  cfg: HaloConfig,
  reportId: string,
): Promise<BasicReport> {
  // Accept either bare ID or the full "basicReports/<id>" form.
  const id = reportId.replace(/^basicReports\//, "");
  if (isFakeMode()) {
    const fixture = findFixtureReport(id) ?? findFixtureReport(reportId);
    if (!fixture) {
      throw new Error(
        `Unknown fake report '${reportId}'. Available: ${FIXTURE_REPORTS.map((r) => (r.name as string).split("/").pop()).join(", ")}`,
      );
    }
    return fixture;
  }
  const key = `${cfg.mcId}:${id}`;
  const cached = reportCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.report;
  }
  const report = await haloGet<BasicReport>(
    cfg,
    `/v2alpha/${cfg.mcId}/basicReports/${encodeURIComponent(id)}`,
  );
  reportCache.set(key, { report, expiresAt: Date.now() + REPORT_CACHE_TTL_MS });
  return report;
}
