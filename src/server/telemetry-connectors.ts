import crypto from "node:crypto";
import type {
  NormalizedSecurityAnomaly,
  NormalizedTelemetryMetric,
  OperatingMode,
  TelemetryAnomalySeverity,
  TelemetryConnectorSource,
  TelemetryConnectorState,
  TelemetryConnectorStatus,
  TelemetryDataOrigin,
  TelemetryHealth,
  TelemetryResource,
  TelemetrySnapshot
} from "../types.ts";
import { GoogleMonitoringReadConnector, type ExternalSignal } from "./connectors.ts";
import type { SecretProvider } from "./secrets.ts";

type FetchLike = typeof fetch;
type Clock = () => Date;

const CONNECTOR_SOURCES: TelemetryConnectorSource[] = [
  "DATADOG",
  "SPLUNK",
  "SOLARWINDS",
  "GOOGLE_CLOUD_MONITORING"
];

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_STALE_RETENTION_MS = 10 * 60_000;
const DEFAULT_FRESHNESS_MS = 2 * 60_000;

export interface TelemetryConnectorSample {
  source: TelemetryConnectorSource;
  collectedAt: string;
  metrics: NormalizedTelemetryMetric[];
  anomalies: NormalizedSecurityAnomaly[];
  warnings?: Array<{ code: string; message: string }>;
}

export interface TelemetryConnectorAdapter {
  readonly source: TelemetryConnectorSource;
  collect(): Promise<TelemetryConnectorSample>;
}

export class TelemetryConnectorError extends Error {
  constructor(
    public readonly source: TelemetryConnectorSource,
    public readonly code: string,
    public readonly connectorState: Extract<TelemetryConnectorState, "UNAVAILABLE" | "ERROR">,
    public readonly enabled: boolean,
    message: string
  ) {
    super(message);
    this.name = "TelemetryConnectorError";
  }
}

export interface TelemetryAdapterDependencies {
  secrets: SecretProvider;
  /** Non-secret flags, endpoints, project IDs and query configuration. Defaults to process.env. */
  configuration?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  now?: Clock;
  timeoutMs?: number;
  freshnessMs?: number;
}

type AdapterDependencies = TelemetryAdapterDependencies;

interface MetricQuery {
  name: string;
  displayName: string;
  query: string;
  unit: string;
  warnAbove?: number;
  criticalAbove?: number;
  warnBelow?: number;
  criticalBelow?: number;
  scale?: number;
}

function clamp(value: number, minimum: number, maximum: number, fallback: number) {
  return Number.isFinite(value) ? Math.min(Math.max(value, minimum), maximum) : fallback;
}

function iso(value: unknown, fallback: Date) {
  const date = value instanceof Date ? value : new Date(typeof value === "number" || typeof value === "string" ? value : NaN);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback.toISOString();
}

function observedAt(value: unknown, collectedAt: Date) {
  const parsed = new Date(typeof value === "number" || typeof value === "string" ? value : NaN);
  return Number.isFinite(parsed.getTime())
    ? { value: parsed.toISOString(), assumed: false }
    : { value: collectedAt.toISOString(), assumed: true };
}

function stableId(...parts: unknown[]) {
  return crypto.createHash("sha256").update(parts.map(value => String(value ?? "")).join("\u001f")).digest("hex").slice(0, 24);
}

function safeText(value: unknown, fallback: string, maximum = 500) {
  const text = String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maximum);
}

function safeLabels(input: unknown, maximum = 20): Record<string, string> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const labels = Object.entries(input as Record<string, unknown>)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, maximum)
    .map(([key, value]) => [safeText(key, "label", 80), safeText(value, "", 200)] as const);
  return labels.length ? Object.fromEntries(labels) : undefined;
}

function ageSeconds(timestamp: string, now: Date) {
  return Math.max(0, Math.round((now.getTime() - new Date(timestamp).getTime()) / 1_000));
}

function freshness(timestamp: string, assumed: boolean, now: Date, freshnessMs: number) {
  if (assumed) return { ageSeconds: 0, freshness: "UNKNOWN" as const, stale: false };
  const age = ageSeconds(timestamp, now);
  return { ageSeconds: age, freshness: age * 1_000 > freshnessMs ? "STALE" as const : "FRESH" as const, stale: age * 1_000 > freshnessMs };
}

function healthFromThreshold(value: number, query: Pick<MetricQuery, "warnAbove" | "criticalAbove" | "warnBelow" | "criticalBelow">): TelemetryHealth {
  if (query.criticalAbove !== undefined && value >= query.criticalAbove) return "CRITICAL";
  if (query.criticalBelow !== undefined && value <= query.criticalBelow) return "CRITICAL";
  if (query.warnAbove !== undefined && value >= query.warnAbove) return "DEGRADED";
  if (query.warnBelow !== undefined && value <= query.warnBelow) return "DEGRADED";
  const hasPolicy = query.warnAbove !== undefined || query.criticalAbove !== undefined || query.warnBelow !== undefined || query.criticalBelow !== undefined;
  return hasPolicy ? "HEALTHY" : "UNKNOWN";
}

function normalizeSeverity(value: unknown): TelemetryAnomalySeverity {
  const severity = String(value || "").toLowerCase();
  if (severity.includes("critical") || severity.includes("fatal") || severity === "5") return "CRITICAL";
  if (severity.includes("high") || severity.includes("error") || severity === "4") return "HIGH";
  if (severity.includes("medium") || severity.includes("warn") || severity === "3") return "MEDIUM";
  if (severity.includes("low") || severity === "2") return "LOW";
  return "INFO";
}

function resource(input: Partial<TelemetryResource> & Pick<TelemetryResource, "id" | "type">): TelemetryResource {
  return {
    id: safeText(input.id, "unknown", 240),
    type: safeText(input.type, "unknown", 120),
    ...(input.name ? { name: safeText(input.name, "unknown", 240) } : {}),
    ...(input.region ? { region: safeText(input.region, "unknown", 120) } : {}),
    ...(input.environment ? { environment: safeText(input.environment, "unknown", 120) } : {}),
    ...(input.labels ? { labels: safeLabels(input.labels) } : {})
  };
}

function metric(input: {
  source: TelemetryConnectorSource;
  origin?: TelemetryDataOrigin;
  name: string;
  displayName: string;
  value: number;
  unit: string;
  observedAt?: unknown;
  collectedAt: Date;
  freshnessMs: number;
  health: TelemetryHealth;
  resource: TelemetryResource;
}): NormalizedTelemetryMetric {
  const timestamp = observedAt(input.observedAt, input.collectedAt);
  const quality = freshness(timestamp.value, timestamp.assumed, input.collectedAt, input.freshnessMs);
  return {
    id: stableId(input.source, input.name, input.resource.id),
    source: input.source,
    dataOrigin: input.origin || "LIVE",
    name: safeText(input.name, "unknown_metric", 120),
    displayName: safeText(input.displayName, input.name, 160),
    value: Number(input.value),
    unit: safeText(input.unit, "value", 40),
    observedAt: timestamp.value,
    collectedAt: input.collectedAt.toISOString(),
    ageSeconds: quality.ageSeconds,
    freshness: quality.freshness,
    stale: quality.stale,
    health: quality.stale ? "UNKNOWN" : input.health,
    resource: input.resource,
    ...(timestamp.assumed ? { observedAtAssumed: true } : {})
  };
}

function anomaly(input: {
  source: TelemetryConnectorSource;
  origin?: TelemetryDataOrigin;
  externalId?: unknown;
  signalType: string;
  title: string;
  description: string;
  severity: TelemetryAnomalySeverity;
  confidence?: number;
  observedAt?: unknown;
  collectedAt: Date;
  freshnessMs: number;
  resource: TelemetryResource;
  indicators?: Record<string, string | number | boolean>;
}): NormalizedSecurityAnomaly {
  const timestamp = observedAt(input.observedAt, input.collectedAt);
  const quality = freshness(timestamp.value, timestamp.assumed, input.collectedAt, input.freshnessMs);
  return {
    id: stableId(input.source, input.externalId, input.signalType, input.resource.id, timestamp.value),
    source: input.source,
    dataOrigin: input.origin || "LIVE",
    signalType: safeText(input.signalType, "ANOMALY", 120),
    title: safeText(input.title, "Telemetry anomaly", 240),
    description: safeText(input.description, "Anomaly reported by telemetry connector.", 1_000),
    severity: input.severity,
    ...(Number.isFinite(input.confidence) ? { confidence: clamp(Number(input.confidence), 0, 1, 0) } : {}),
    observedAt: timestamp.value,
    collectedAt: input.collectedAt.toISOString(),
    ageSeconds: quality.ageSeconds,
    freshness: quality.freshness,
    stale: quality.stale,
    resource: input.resource,
    ...(input.indicators ? { indicators: Object.fromEntries(Object.entries(input.indicators).slice(0, 20)) } : {})
  };
}

function endpoint(value: string, source: TelemetryConnectorSource) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TelemetryConnectorError(source, "INVALID_ENDPOINT", "UNAVAILABLE", true, `${source} endpoint is not a valid URL.`);
  }
  const localhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(localhost && parsed.protocol === "http:")) {
    throw new TelemetryConnectorError(source, "INSECURE_ENDPOINT", "UNAVAILABLE", true, `${source} requires HTTPS unless the endpoint is localhost.`);
  }
  if (parsed.username || parsed.password) {
    throw new TelemetryConnectorError(source, "CREDENTIALS_IN_URL", "UNAVAILABLE", true, `${source} credentials must be supplied through SecretProvider, not embedded in its URL.`);
  }
  return parsed;
}

async function fetchResponse(source: TelemetryConnectorSource, fetchImpl: FetchLike, url: URL, init: RequestInit, timeoutMs: number) {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error: any) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError" || /timeout/i.test(String(error?.message));
    throw new TelemetryConnectorError(
      source,
      timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNREACHABLE",
      "ERROR",
      true,
      timedOut ? `${source} did not respond within the configured timeout.` : `${source} could not be reached.`
    );
  }
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? "AUTHENTICATION_FAILED"
      : response.status === 429
        ? "RATE_LIMITED"
        : "UPSTREAM_HTTP_ERROR";
    throw new TelemetryConnectorError(source, code, "ERROR", true, `${source} returned HTTP ${response.status}.`);
  }
  return response;
}

async function responseJson(source: TelemetryConnectorSource, fetchImpl: FetchLike, url: URL, init: RequestInit, timeoutMs: number) {
  const response = await fetchResponse(source, fetchImpl, url, init, timeoutMs);
  try {
    return await response.json() as any;
  } catch {
    throw new TelemetryConnectorError(source, "INVALID_RESPONSE", "ERROR", true, `${source} returned an invalid JSON response.`);
  }
}

async function requiredConfiguration(
  source: TelemetryConnectorSource,
  dependencies: AdapterDependencies,
  enabledName: string,
  requiredConfigurationNames: string[],
  requiredSecretNames: string[]
) {
  const configurationValue = (name: string) => {
    const configured = dependencies.configuration && Object.prototype.hasOwnProperty.call(dependencies.configuration, name)
      ? dependencies.configuration[name]
      : process.env[name];
    return configured?.trim();
  };
  const enabled = String(configurationValue(enabledName) || "").toLowerCase() === "true";
  if (!enabled) {
    throw new TelemetryConnectorError(source, "CONNECTOR_DISABLED", "UNAVAILABLE", false, `${source} live connector is disabled.`);
  }
  const configured: Record<string, string | undefined> = Object.fromEntries(
    requiredConfigurationNames.map(name => [name, configurationValue(name)])
  );
  try {
    const secrets = await Promise.all(requiredSecretNames.map(name => dependencies.secrets.get(name)));
    // Preserve credential bytes exactly; passwords may intentionally contain
    // leading or trailing spaces and must not be normalized.
    requiredSecretNames.forEach((name, index) => configured[name] = secrets[index]);
  } catch {
    throw new TelemetryConnectorError(source, "SECRET_PROVIDER_ERROR", "ERROR", true, `${source} credentials could not be loaded.`);
  }
  const missing = [...requiredConfigurationNames, ...requiredSecretNames].filter(name => !configured[name] || !configured[name]?.trim());
  if (missing.length) {
    throw new TelemetryConnectorError(source, "MISSING_CONFIGURATION", "UNAVAILABLE", true, `${source} is enabled but required configuration is missing.`);
  }
  return configured as Record<string, string>;
}

function optionalConfiguration(dependencies: AdapterDependencies, name: string) {
  return (dependencies.configuration && Object.prototype.hasOwnProperty.call(dependencies.configuration, name)
    ? dependencies.configuration[name]
    : process.env[name])?.trim();
}

function parseMetricQueries(raw: string | undefined, defaults: MetricQuery[], source: TelemetryConnectorSource) {
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 20) throw new Error("invalid array");
    return parsed.map((item: any, index: number): MetricQuery => {
      if (!item || typeof item !== "object" || !String(item.query || "").trim()) throw new Error(`invalid query ${index}`);
      return {
        name: safeText(item.name, `metric_${index + 1}`, 120),
        displayName: safeText(item.displayName, item.name || `Metric ${index + 1}`, 160),
        query: String(item.query).trim().slice(0, 4_000),
        unit: safeText(item.unit, "value", 40),
        ...(Number.isFinite(item.warnAbove) ? { warnAbove: Number(item.warnAbove) } : {}),
        ...(Number.isFinite(item.criticalAbove) ? { criticalAbove: Number(item.criticalAbove) } : {}),
        ...(Number.isFinite(item.warnBelow) ? { warnBelow: Number(item.warnBelow) } : {}),
        ...(Number.isFinite(item.criticalBelow) ? { criticalBelow: Number(item.criticalBelow) } : {}),
        ...(Number.isFinite(item.scale) ? { scale: Number(item.scale) } : {})
      };
    });
  } catch {
    throw new TelemetryConnectorError(source, "INVALID_QUERY_CONFIGURATION", "UNAVAILABLE", true, `${source} metric query configuration is invalid.`);
  }
}

const DATADOG_DEFAULT_QUERIES: MetricQuery[] = [
  { name: "requests_per_second", displayName: "Ingress request rate", query: "sum:trace.http.request.hits{*}.as_rate()", unit: "req/s" },
  { name: "cpu_utilization_percent", displayName: "Compute utilization", query: "avg:system.cpu.user{*}", unit: "%", warnAbove: 80, criticalAbove: 95 },
  { name: "database_latency_ms", displayName: "Database latency", query: "avg:trace.postgres.query.duration{*}", unit: "ms", warnAbove: 200, criticalAbove: 500 }
];

export class DatadogTelemetryAdapter implements TelemetryConnectorAdapter {
  readonly source = "DATADOG" as const;
  private readonly fetchImpl: FetchLike;
  private readonly now: Clock;
  private readonly timeoutMs: number;
  private readonly freshnessMs: number;

  constructor(private readonly dependencies: AdapterDependencies) {
    this.fetchImpl = dependencies.fetchImpl || fetch;
    this.now = dependencies.now || (() => new Date());
    this.timeoutMs = clamp(Number(dependencies.timeoutMs), 1_000, 30_000, DEFAULT_TIMEOUT_MS);
    this.freshnessMs = clamp(Number(dependencies.freshnessMs), 5_000, 30 * 60_000, DEFAULT_FRESHNESS_MS);
  }

  async collect(): Promise<TelemetryConnectorSample> {
    const config = await requiredConfiguration(
      this.source,
      this.dependencies,
      "DATADOG_ENABLED",
      ["DATADOG_API_URL"],
      ["DATADOG_API_KEY", "DATADOG_APP_KEY"]
    );
    const base = endpoint(config.DATADOG_API_URL, this.source);
    const queryJson = optionalConfiguration(this.dependencies, "DATADOG_METRIC_QUERIES_JSON");
    const queries = parseMetricQueries(queryJson, DATADOG_DEFAULT_QUERIES, this.source);
    const collectedAt = this.now();
    const from = Math.floor((collectedAt.getTime() - 15 * 60_000) / 1_000);
    const to = Math.floor(collectedAt.getTime() / 1_000);
    const headers = {
      Accept: "application/json",
      "DD-API-KEY": config.DATADOG_API_KEY,
      "DD-APPLICATION-KEY": config.DATADOG_APP_KEY
    };

    const metricResponses = await Promise.all(queries.map(async query => {
      const url = new URL("/api/v1/query", base);
      url.search = new URLSearchParams({ from: String(from), to: String(to), query: query.query }).toString();
      return { query, body: await responseJson(this.source, this.fetchImpl, url, { headers }, this.timeoutMs) };
    }));

    const metrics = metricResponses.flatMap(({ query, body }) => (Array.isArray(body?.series) ? body.series : []).flatMap((series: any) => {
      const points = Array.isArray(series?.pointlist) ? series.pointlist : [];
      const point = [...points].reverse().find(candidate => Array.isArray(candidate) && Number.isFinite(Number(candidate[1])));
      if (!point) return [];
      const value = Number(point[1]) * (query.scale ?? 1);
      const tags = Array.isArray(series.tag_set)
        ? Object.fromEntries(series.tag_set.slice(0, 20).map((tag: string) => {
            const [key, ...rest] = String(tag).split(":");
            return [key || "tag", rest.join(":") || "true"];
          }))
        : {};
      const resourceId = tags.host || series.scope || series.metric || "datadog-global";
      return [metric({
        source: this.source,
        name: query.name,
        displayName: query.displayName,
        value,
        unit: query.unit,
        observedAt: Number(point[0]) * 1_000,
        collectedAt,
        freshnessMs: this.freshnessMs,
        health: healthFromThreshold(value, query),
        resource: resource({ id: resourceId, type: "datadog_scope", name: resourceId, labels: tags })
      })];
    }));

    let anomalies: NormalizedSecurityAnomaly[] = [];
    const warnings: Array<{ code: string; message: string }> = [];
    if (String(optionalConfiguration(this.dependencies, "DATADOG_SECURITY_SIGNALS_ENABLED") || "").toLowerCase() === "true") {
      try {
        const anomalyUrl = new URL("/api/v2/security_monitoring/signals", base);
        anomalyUrl.search = new URLSearchParams({
          "filter[from]": new Date(collectedAt.getTime() - 15 * 60_000).toISOString(),
          "filter[to]": collectedAt.toISOString(),
          "page[limit]": "50"
        }).toString();
        const anomalyBody = await responseJson(this.source, this.fetchImpl, anomalyUrl, { headers }, this.timeoutMs);
        anomalies = (Array.isArray(anomalyBody?.data) ? anomalyBody.data : []).map((signal: any) => {
          const attributes = signal?.attributes || {};
          const tags = Array.isArray(attributes.tags)
            ? Object.fromEntries(attributes.tags.slice(0, 20).map((tag: string) => {
                const [key, ...rest] = String(tag).split(":");
                return [key || "tag", rest.join(":") || "true"];
              }))
            : {};
          const host = tags.host || attributes.host || "datadog-security";
          return anomaly({
            source: this.source,
            externalId: signal.id,
            signalType: attributes.security_rule?.type || "SECURITY_SIGNAL",
            title: attributes.security_rule?.name || attributes.title || "Datadog security signal",
            description: attributes.message || "A Datadog security rule matched live telemetry.",
            severity: normalizeSeverity(attributes.severity || attributes.priority),
            observedAt: attributes.timestamp || attributes.created_at,
            collectedAt,
            freshnessMs: this.freshnessMs,
            resource: resource({ id: host, type: "host", name: host, labels: tags }),
            indicators: { status: safeText(attributes.status, "triggered", 80) }
          });
        });
      } catch (error) {
        const code = error instanceof TelemetryConnectorError ? error.code : "SECURITY_SIGNAL_FETCH_FAILED";
        warnings.push({
          code,
          message: "Datadog metrics are live, but optional security signals could not be refreshed."
        });
      }
    }

    return { source: this.source, collectedAt: collectedAt.toISOString(), metrics, anomalies, ...(warnings.length ? { warnings } : {}) };
  }
}

const SPLUNK_DEFAULT_QUERIES: MetricQuery[] = [
  {
    name: "events_ingested_15m",
    displayName: "Events ingested (15m)",
    query: "search index=* earliest=-15m | stats count as value",
    unit: "events"
  }
];

function parseSplunkExport(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const whole = JSON.parse(trimmed);
    if (Array.isArray(whole?.results)) return whole.results;
    if (whole?.result) return [whole.result];
  } catch {
    // The export endpoint commonly emits newline-delimited JSON.
  }
  return trimmed.split(/\r?\n/).flatMap(line => {
    try {
      const parsed = JSON.parse(line);
      return parsed?.result ? [parsed.result] : [];
    } catch {
      return [];
    }
  });
}

export class SplunkTelemetryAdapter implements TelemetryConnectorAdapter {
  readonly source = "SPLUNK" as const;
  private readonly fetchImpl: FetchLike;
  private readonly now: Clock;
  private readonly timeoutMs: number;
  private readonly freshnessMs: number;

  constructor(private readonly dependencies: AdapterDependencies) {
    this.fetchImpl = dependencies.fetchImpl || fetch;
    this.now = dependencies.now || (() => new Date());
    this.timeoutMs = clamp(Number(dependencies.timeoutMs), 1_000, 30_000, DEFAULT_TIMEOUT_MS);
    this.freshnessMs = clamp(Number(dependencies.freshnessMs), 5_000, 30 * 60_000, DEFAULT_FRESHNESS_MS);
  }

  private async search(base: URL, token: string, query: string) {
    const url = new URL(base.toString());
    const exportPath = optionalConfiguration(this.dependencies, "SPLUNK_SEARCH_EXPORT_PATH") || "/services/search/v2/jobs/export";
    if (!/^\/[a-zA-Z0-9._~/-]+$/.test(exportPath) || exportPath.includes("..")) {
      throw new TelemetryConnectorError(this.source, "INVALID_EXPORT_PATH", "UNAVAILABLE", true, "Splunk export path configuration is invalid.");
    }
    url.pathname = exportPath;
    const response = await fetchResponse(this.source, this.fetchImpl, url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ search: query, output_mode: "json" })
    }, this.timeoutMs);
    return parseSplunkExport(await response.text());
  }

  async collect(): Promise<TelemetryConnectorSample> {
    const config = await requiredConfiguration(
      this.source,
      this.dependencies,
      "SPLUNK_ENABLED",
      ["SPLUNK_API_URL"],
      ["SPLUNK_ACCESS_TOKEN"]
    );
    const base = endpoint(config.SPLUNK_API_URL, this.source);
    const queryJson = optionalConfiguration(this.dependencies, "SPLUNK_METRIC_SEARCHES_JSON");
    const queries = parseMetricQueries(queryJson, SPLUNK_DEFAULT_QUERIES, this.source);
    const anomalySearch = optionalConfiguration(this.dependencies, "SPLUNK_ANOMALY_SEARCH") ||
      "search index=* earliest=-15m (severity=critical OR severity=high) | head 50 | table _time host source severity signature message risk_score";
    const collectedAt = this.now();
    const metricRows = await Promise.all(queries.map(async query => ({ query, rows: await this.search(base, config.SPLUNK_ACCESS_TOKEN, query.query) })));
    const metrics = metricRows.flatMap(({ query, rows }) => rows.flatMap((row: any, index: number) => {
      const value = Number(row.value ?? row.count ?? row.metric_value);
      if (!Number.isFinite(value)) return [];
      const scaled = value * (query.scale ?? 1);
      const host = row.host || row.resource || `splunk-search-${index + 1}`;
      return [metric({
        source: this.source,
        name: query.name,
        displayName: query.displayName,
        value: scaled,
        unit: query.unit,
        observedAt: row._time || row.observed_at,
        collectedAt,
        freshnessMs: this.freshnessMs,
        health: healthFromThreshold(scaled, query),
        resource: resource({ id: host, type: "splunk_event_source", name: host, labels: safeLabels({ source: row.source, sourcetype: row.sourcetype, index: row.index }) })
      })];
    }));
    let anomalies: NormalizedSecurityAnomaly[] = [];
    const warnings: Array<{ code: string; message: string }> = [];
    if (String(optionalConfiguration(this.dependencies, "SPLUNK_ANOMALY_SEARCH_ENABLED") || "").toLowerCase() === "true") {
      try {
        const anomalyRows = await this.search(base, config.SPLUNK_ACCESS_TOKEN, anomalySearch);
        anomalies = anomalyRows.map((row: any, index: number) => {
          const host = row.host || row.dest || row.src || `splunk-event-${index + 1}`;
          const riskScore = Number(row.risk_score ?? row.confidence);
          return anomaly({
            source: this.source,
            externalId: row.event_id || row.sid || index,
            signalType: row.signature || row.rule_name || "SIEM_CORRELATION",
            title: row.signature || row.rule_name || "Splunk security correlation",
            description: row.message || row.description || "A Splunk correlation search identified a possible threat.",
            severity: normalizeSeverity(row.severity || row.urgency),
            confidence: Number.isFinite(riskScore) ? (riskScore > 1 ? riskScore / 100 : riskScore) : undefined,
            observedAt: row._time || row.observed_at,
            collectedAt,
            freshnessMs: this.freshnessMs,
            resource: resource({ id: host, type: "host", name: host, labels: safeLabels({ source: row.source, sourcetype: row.sourcetype }) }),
            indicators: {
              ...(row.src ? { sourceAddress: safeText(row.src, "", 120) } : {}),
              ...(row.dest ? { destination: safeText(row.dest, "", 120) } : {}),
              ...(Number.isFinite(riskScore) ? { riskScore } : {})
            }
          });
        });
      } catch (error) {
        const code = error instanceof TelemetryConnectorError ? error.code : "ANOMALY_SEARCH_FAILED";
        warnings.push({ code, message: "Splunk metrics are live, but the optional anomaly search could not be refreshed." });
      }
    }
    return { source: this.source, collectedAt: collectedAt.toISOString(), metrics, anomalies, ...(warnings.length ? { warnings } : {}) };
  }
}

const SOLARWINDS_QUERY = "SELECT TOP 100 NodeID, Caption, Status, ResponseTime, PercentLoss, CPULoad, LastSync, Location, MachineType FROM Orion.Nodes";

export class SolarWindsTelemetryAdapter implements TelemetryConnectorAdapter {
  readonly source = "SOLARWINDS" as const;
  private readonly fetchImpl: FetchLike;
  private readonly now: Clock;
  private readonly timeoutMs: number;
  private readonly freshnessMs: number;

  constructor(private readonly dependencies: AdapterDependencies) {
    this.fetchImpl = dependencies.fetchImpl || fetch;
    this.now = dependencies.now || (() => new Date());
    this.timeoutMs = clamp(Number(dependencies.timeoutMs), 1_000, 30_000, DEFAULT_TIMEOUT_MS);
    this.freshnessMs = clamp(Number(dependencies.freshnessMs), 5_000, 30 * 60_000, DEFAULT_FRESHNESS_MS);
  }

  async collect(): Promise<TelemetryConnectorSample> {
    if (String(optionalConfiguration(this.dependencies, "SOLARWINDS_ENABLED") || "").toLowerCase() !== "true") {
      throw new TelemetryConnectorError(this.source, "CONNECTOR_DISABLED", "UNAVAILABLE", false, "SOLARWINDS live connector is disabled.");
    }
    const authModeValue = (optionalConfiguration(this.dependencies, "SOLARWINDS_AUTH_MODE") || "BASIC").toUpperCase();
    if (authModeValue !== "BASIC" && authModeValue !== "BEARER") {
      throw new TelemetryConnectorError(
        this.source,
        "INVALID_AUTH_MODE",
        "UNAVAILABLE",
        true,
        "SolarWinds authentication mode must be BASIC or BEARER."
      );
    }
    const authMode = authModeValue as "BASIC" | "BEARER";
    const config = await requiredConfiguration(
      this.source,
      this.dependencies,
      "SOLARWINDS_ENABLED",
      ["SOLARWINDS_API_URL"],
      authMode === "BASIC"
        ? ["SOLARWINDS_USERNAME", "SOLARWINDS_PASSWORD"]
        : ["SOLARWINDS_ACCESS_TOKEN"]
    );
    const base = endpoint(config.SOLARWINDS_API_URL, this.source);
    let authorization: string;
    if (authMode === "BASIC") {
      if (
        config.SOLARWINDS_USERNAME.length > 512 ||
        config.SOLARWINDS_PASSWORD.length > 4_096 ||
        config.SOLARWINDS_USERNAME.includes(":") ||
        /[\r\n]/.test(config.SOLARWINDS_USERNAME) ||
        /[\r\n]/.test(config.SOLARWINDS_PASSWORD)
      ) {
        throw new TelemetryConnectorError(
          this.source,
          "INVALID_CREDENTIAL_FORMAT",
          "UNAVAILABLE",
          true,
          "SolarWinds Basic credentials contain unsupported characters."
        );
      }
      authorization = `Basic ${Buffer.from(`${config.SOLARWINDS_USERNAME}:${config.SOLARWINDS_PASSWORD}`, "utf8").toString("base64")}`;
    } else {
      if (config.SOLARWINDS_ACCESS_TOKEN.length > 8_192 || /[\r\n]/.test(config.SOLARWINDS_ACCESS_TOKEN)) {
        throw new TelemetryConnectorError(
          this.source,
          "INVALID_CREDENTIAL_FORMAT",
          "UNAVAILABLE",
          true,
          "SolarWinds bearer credential contains unsupported characters."
        );
      }
      authorization = `Bearer ${config.SOLARWINDS_ACCESS_TOKEN}`;
    }
    const configuredQuery = optionalConfiguration(this.dependencies, "SOLARWINDS_NODE_QUERY");
    const query = (configuredQuery || SOLARWINDS_QUERY).trim().slice(0, 8_000);
    if (!/^SELECT\s/i.test(query) || /\b(UPDATE|DELETE|INSERT|DROP|CREATE|ALTER|INVOKE)\b/i.test(query)) {
      throw new TelemetryConnectorError(this.source, "NON_READ_ONLY_QUERY", "UNAVAILABLE", true, "SolarWinds query must be a read-only SWQL SELECT statement.");
    }
    const url = new URL(base.toString());
    const basePath = url.pathname.replace(/\/$/, "");
    url.pathname = /\/Query$/i.test(basePath)
      ? basePath
      : basePath === ""
        ? "/SolarWinds/InformationService/v3/Json/Query"
        : `${basePath}/Query`;
    url.search = new URLSearchParams({ query }).toString();
    const collectedAt = this.now();
    const body = await responseJson(this.source, this.fetchImpl, url, {
      headers: { Accept: "application/json", Authorization: authorization }
    }, this.timeoutMs);
    const rows = Array.isArray(body?.results) ? body.results.slice(0, 100) : [];
    const metrics: NormalizedTelemetryMetric[] = [];
    const anomalies: NormalizedSecurityAnomaly[] = [];
    for (const row of rows) {
      const nodeId = String(row.NodeID ?? row.nodeId ?? row.Caption ?? "unknown-node");
      const caption = String(row.Caption ?? row.caption ?? nodeId);
      const observed = row.LastSync ?? row.lastSync;
      const nodeResource = resource({
        id: nodeId,
        type: row.MachineType || "network_node",
        name: caption,
        region: row.Location,
        labels: safeLabels({ location: row.Location, machineType: row.MachineType })
      });
      const values: Array<[string, string, unknown, string, MetricQuery]> = [
        ["network_latency_ms", "Network response time", row.ResponseTime, "ms", { name: "", displayName: "", query: "", unit: "", warnAbove: 100, criticalAbove: 300 }],
        ["packet_loss_percent", "Packet loss", row.PercentLoss, "%", { name: "", displayName: "", query: "", unit: "", warnAbove: 2, criticalAbove: 10 }],
        ["cpu_utilization_percent", "Network device CPU", row.CPULoad, "%", { name: "", displayName: "", query: "", unit: "", warnAbove: 80, criticalAbove: 95 }]
      ];
      for (const [name, displayName, rawValue, unit, policy] of values) {
        const value = Number(rawValue);
        if (!Number.isFinite(value)) continue;
        metrics.push(metric({
          source: this.source,
          name,
          displayName,
          value,
          unit,
          observedAt: observed,
          collectedAt,
          freshnessMs: this.freshnessMs,
          health: healthFromThreshold(value, policy),
          resource: nodeResource
        }));
      }
      const status = Number(row.Status ?? row.status);
      const packetLoss = Number(row.PercentLoss);
      if ((Number.isFinite(status) && status !== 1) || (Number.isFinite(packetLoss) && packetLoss >= 10)) {
        anomalies.push(anomaly({
          source: this.source,
          externalId: `${nodeId}:${status}`,
          signalType: "NETWORK_DEVICE_HEALTH",
          title: `${caption} is reporting an unhealthy state`,
          description: `SolarWinds reports node status ${Number.isFinite(status) ? status : "unknown"} and packet loss ${Number.isFinite(packetLoss) ? `${packetLoss}%` : "unknown"}.`,
          severity: status === 2 || packetLoss >= 50 ? "CRITICAL" : "HIGH",
          observedAt: observed,
          collectedAt,
          freshnessMs: this.freshnessMs,
          resource: nodeResource,
          indicators: {
            ...(Number.isFinite(status) ? { nodeStatus: status } : {}),
            ...(Number.isFinite(packetLoss) ? { packetLossPercent: packetLoss } : {})
          }
        }));
      }
    }
    return { source: this.source, collectedAt: collectedAt.toISOString(), metrics, anomalies };
  }
}

interface GoogleSignalReader {
  signals(limit?: number): Promise<ExternalSignal[]>;
}

export class GoogleCloudMonitoringTelemetryAdapter implements TelemetryConnectorAdapter {
  readonly source = "GOOGLE_CLOUD_MONITORING" as const;
  private readonly now: Clock;
  private readonly freshnessMs: number;
  private readonly reader?: GoogleSignalReader;

  constructor(
    private readonly dependencies: Pick<AdapterDependencies, "secrets" | "configuration" | "now" | "freshnessMs">,
    reader?: GoogleSignalReader
  ) {
    this.now = dependencies.now || (() => new Date());
    this.freshnessMs = clamp(Number(dependencies.freshnessMs), 5_000, 30 * 60_000, DEFAULT_FRESHNESS_MS);
    this.reader = reader;
  }

  async collect(): Promise<TelemetryConnectorSample> {
    const config = await requiredConfiguration(
      this.source,
      this.dependencies,
      "GOOGLE_MONITORING_ENABLED",
      ["GOOGLE_CLOUD_PROJECT"],
      []
    );
    const collectedAt = this.now();
    let signals: ExternalSignal[];
    try {
      const reader = this.reader || new GoogleMonitoringReadConnector({
        projectId: config.GOOGLE_CLOUD_PROJECT,
        metricType: optionalConfiguration(this.dependencies, "GOOGLE_MONITORING_METRIC_TYPE")
      });
      signals = await reader.signals(100);
    } catch (error) {
      if (error instanceof TelemetryConnectorError) throw error;
      throw new TelemetryConnectorError(this.source, "UPSTREAM_ERROR", "ERROR", true, "Google Cloud Monitoring could not return telemetry.");
    }
    const metrics = signals.flatMap((signal, index) => {
      const series: any = signal.raw || {};
      const point = series.points?.[0];
      const valueObject = point?.value || {};
      const rawValue = valueObject.doubleValue ?? valueObject.int64Value ?? valueObject.boolValue;
      const value = typeof rawValue === "boolean" ? (rawValue ? 1 : 0) : Number(rawValue);
      if (!Number.isFinite(value)) return [];
      const metricType = String(series.metric?.type || signal.externalId.split(":")[0] || "google_cloud_metric");
      const labels = { ...(series.resource?.labels || {}), ...(series.metric?.labels || {}) };
      const resourceId = labels.instance_id || labels.database_id || labels.pod_name || signal.resource || `google-resource-${index + 1}`;
      return [metric({
        source: this.source,
        name: metricType.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase(),
        displayName: metricType,
        value,
        unit: safeText(series.unit, "value", 40),
        observedAt: point?.interval?.endTime || signal.observedAt,
        collectedAt,
        freshnessMs: this.freshnessMs,
        health: "UNKNOWN",
        resource: resource({
          id: resourceId,
          type: series.resource?.type || "google_cloud_resource",
          name: labels.instance_name || labels.pod_name || signal.resource,
          region: labels.region || labels.zone,
          labels: safeLabels(labels)
        })
      })];
    });
    return { source: this.source, collectedAt: collectedAt.toISOString(), metrics, anomalies: [] };
  }
}

function simulationSample(source: TelemetryConnectorSource, now: Date, freshnessMs: number): TelemetryConnectorSample {
  const definitions: Record<TelemetryConnectorSource, Array<{
    name: string;
    displayName: string;
    value: number;
    unit: string;
    health: TelemetryHealth;
    resourceId: string;
    resourceType: string;
  }>> = {
    DATADOG: [
      { name: "requests_per_second", displayName: "Ingress request rate", value: 2_516, unit: "req/s", health: "HEALTHY", resourceId: "sim-api-gateway", resourceType: "service" },
      { name: "cpu_utilization_percent", displayName: "Compute utilization", value: 52, unit: "%", health: "HEALTHY", resourceId: "sim-app-cluster", resourceType: "cluster" }
    ],
    SPLUNK: [
      { name: "security_posture_score", displayName: "Security posture", value: 98, unit: "/100", health: "HEALTHY", resourceId: "sim-enterprise", resourceType: "security_domain" },
      { name: "active_security_anomalies", displayName: "Active security anomalies", value: 1, unit: "signals", health: "DEGRADED", resourceId: "in-blr-core-switch-01", resourceType: "network_switch" }
    ],
    SOLARWINDS: [
      { name: "network_latency_ms", displayName: "Network response time", value: 320, unit: "ms", health: "CRITICAL", resourceId: "in-blr-core-switch-01", resourceType: "network_switch" },
      { name: "packet_loss_percent", displayName: "Packet loss", value: 12, unit: "%", health: "CRITICAL", resourceId: "in-blr-core-switch-01", resourceType: "network_switch" }
    ],
    GOOGLE_CLOUD_MONITORING: [
      { name: "database_latency_ms", displayName: "Database latency", value: 3, unit: "ms", health: "HEALTHY", resourceId: "sim-cloudsql-primary", resourceType: "database" },
      { name: "active_incidents", displayName: "Active operations", value: 2, unit: "incidents", health: "DEGRADED", resourceId: "sim-operations", resourceType: "operations" }
    ]
  };
  const metrics = definitions[source].map(definition => metric({
    source,
    origin: "SIMULATION",
    name: definition.name,
    displayName: definition.displayName,
    value: definition.value,
    unit: definition.unit,
    observedAt: now,
    collectedAt: now,
    freshnessMs,
    health: definition.health,
    resource: resource({
      id: definition.resourceId,
      type: definition.resourceType,
      name: definition.resourceId,
      labels: { simulation: "true" }
    })
  }));
  const anomalies: NormalizedSecurityAnomaly[] = [];
  if (source === "SPLUNK") {
    anomalies.push(anomaly({
        source,
        origin: "SIMULATION",
        externalId: "sim-splunk-privileged-change-1",
        signalType: "VALID_ACCOUNT_ABUSE",
        title: "Simulated privileged switch configuration anomaly",
        description: "Synthetic Splunk evidence places an unusual privileged login and configuration event before the switch degradation; no live threat was detected.",
        severity: "HIGH",
        confidence: 0.86,
        observedAt: new Date(now.getTime() - 2 * 60_000),
        collectedAt: now,
        freshnessMs,
        resource: resource({
          id: "in-blr-core-switch-01",
          type: "network_switch",
          name: "Bengaluru Cisco Catalyst 9500 Switch Stack",
          region: "India",
          labels: { simulation: "true", cmdb_ci: "in-blr-core-switch-01" }
        }),
        indicators: { simulated: true, eventType: "privileged_configuration_change" }
      }));
  }
  if (source === "SOLARWINDS") {
    anomalies.push(anomaly({
      source,
      origin: "SIMULATION",
      externalId: "sim-solarwinds-switch-health-1",
      signalType: "NETWORK_DEVICE_HEALTH",
      title: "Simulated core switch availability degradation",
      description: "Synthetic SolarWinds evidence reports critical latency and packet loss on the same CMDB switch; no live outage was detected.",
      severity: "CRITICAL",
      confidence: 0.94,
      observedAt: now,
      collectedAt: now,
      freshnessMs,
      resource: resource({
        id: "in-blr-core-switch-01",
        type: "network_switch",
        name: "Bengaluru Cisco Catalyst 9500 Switch Stack",
        region: "India",
        labels: { simulation: "true", cmdb_ci: "in-blr-core-switch-01" }
      }),
      indicators: { simulated: true, nodeStatus: 2, packetLossPercent: 12 }
    }));
  }
  return { source, collectedAt: now.toISOString(), metrics, anomalies };
}

interface LastSuccess {
  at: number;
  sample: TelemetryConnectorSample;
}

export interface TelemetryAggregatorOptions {
  secrets: SecretProvider;
  /** TELEMETRY_MODE is intentionally independent from remediation/execution mode. */
  mode: OperatingMode;
  configuration?: Record<string, string | undefined>;
  adapters?: TelemetryConnectorAdapter[];
  now?: Clock;
  cacheTtlMs?: number;
  staleRetentionMs?: number;
  freshnessMs?: number;
  connectorTimeoutMs?: number;
}

function cloneSnapshot(snapshot: TelemetrySnapshot, cacheHit: boolean): TelemetrySnapshot {
  return {
    ...structuredClone(snapshot),
    cache: { ...snapshot.cache, hit: cacheHit }
  };
}

function markSampleStale(sample: TelemetryConnectorSample, now: Date): TelemetryConnectorSample {
  return {
    ...sample,
    collectedAt: now.toISOString(),
    metrics: sample.metrics.map(item => ({
      ...item,
      collectedAt: now.toISOString(),
      ageSeconds: ageSeconds(item.observedAt, now),
      freshness: "STALE",
      stale: true,
      health: "UNKNOWN"
    })),
    anomalies: sample.anomalies.map(item => ({
      ...item,
      collectedAt: now.toISOString(),
      ageSeconds: ageSeconds(item.observedAt, now),
      freshness: "STALE",
      stale: true
    }))
  };
}

function overallHealth(mode: OperatingMode, statuses: TelemetryConnectorStatus[], metrics: NormalizedTelemetryMetric[], anomalies: NormalizedSecurityAnomaly[]): TelemetryHealth {
  if (metrics.some(item => !item.stale && item.health === "CRITICAL") || anomalies.some(item => !item.stale && item.severity === "CRITICAL")) return "CRITICAL";
  if (metrics.some(item => !item.stale && item.health === "DEGRADED") || anomalies.some(item => !item.stale && ["HIGH", "MEDIUM"].includes(item.severity))) return "DEGRADED";
  if (mode === "LIVE") {
    const connected = statuses.filter(item => item.state === "CONNECTED");
    if (!connected.length) return "UNKNOWN";
    if (statuses.some(item => item.state !== "CONNECTED" || item.warnings?.length)) return "DEGRADED";
  }
  if (statuses.some(item => item.state === "STALE" || item.state === "ERROR")) return "DEGRADED";
  const assessedMetrics = metrics.filter(item => !item.stale && item.health !== "UNKNOWN");
  return assessedMetrics.length ? "HEALTHY" : "UNKNOWN";
}

export class TelemetryAggregator {
  private readonly mode: OperatingMode;
  private readonly now: Clock;
  private readonly cacheTtlMs: number;
  private readonly staleRetentionMs: number;
  private readonly freshnessMs: number;
  private readonly adapters: TelemetryConnectorAdapter[];
  private readonly lastSuccess = new Map<TelemetryConnectorSource, LastSuccess>();
  private cached?: { expiresAt: number; snapshot: TelemetrySnapshot };
  private inFlight?: Promise<TelemetrySnapshot>;

  constructor(options: TelemetryAggregatorOptions) {
    this.mode = options.mode;
    this.now = options.now || (() => new Date());
    this.cacheTtlMs = clamp(Number(options.cacheTtlMs), 5_000, 5 * 60_000, DEFAULT_CACHE_TTL_MS);
    this.staleRetentionMs = clamp(Number(options.staleRetentionMs), this.cacheTtlMs, 60 * 60_000, DEFAULT_STALE_RETENTION_MS);
    this.freshnessMs = clamp(Number(options.freshnessMs), 5_000, 30 * 60_000, DEFAULT_FRESHNESS_MS);
    const dependencies: AdapterDependencies = {
      secrets: options.secrets,
      configuration: options.configuration,
      now: this.now,
      timeoutMs: options.connectorTimeoutMs,
      freshnessMs: this.freshnessMs
    };
    this.adapters = options.adapters || [
      new DatadogTelemetryAdapter(dependencies),
      new SplunkTelemetryAdapter(dependencies),
      new SolarWindsTelemetryAdapter(dependencies),
      new GoogleCloudMonitoringTelemetryAdapter(dependencies)
    ];
  }

  clearCache() {
    this.cached = undefined;
  }

  async collect(options: { force?: boolean } = {}): Promise<TelemetrySnapshot> {
    const nowMs = this.now().getTime();
    if (!options.force && this.cached && nowMs < this.cached.expiresAt) {
      return cloneSnapshot(this.cached.snapshot, true);
    }
    if (this.inFlight) return cloneSnapshot(await this.inFlight, true);
    this.inFlight = this.collectUncached();
    try {
      const snapshot = await this.inFlight;
      this.cached = { expiresAt: new Date(snapshot.expiresAt).getTime(), snapshot };
      return cloneSnapshot(snapshot, false);
    } finally {
      this.inFlight = undefined;
    }
  }

  private async collectUncached(): Promise<TelemetrySnapshot> {
    const startedAt = this.now();
    const outputs = this.mode === "SIMULATION"
      ? CONNECTOR_SOURCES.map(source => {
          const sample = simulationSample(source, startedAt, this.freshnessMs);
          const status: TelemetryConnectorStatus = {
            source,
            state: "SIMULATED",
            enabled: true,
            dataOrigin: "SIMULATION",
            lastAttemptAt: startedAt.toISOString(),
            lastSuccessAt: startedAt.toISOString(),
            metricCount: sample.metrics.length,
            anomalyCount: sample.anomalies.length,
            message: "Synthetic connector sample; no vendor API was called."
          };
          return { sample, status };
        })
      : await Promise.all(this.adapters.map(adapter => this.collectAdapter(adapter, startedAt)));

    if (this.mode === "LIVE") {
      const represented = new Set(outputs.map(output => output.status.source));
      for (const source of CONNECTOR_SOURCES.filter(source => !represented.has(source))) {
        outputs.push({
          sample: { source, collectedAt: startedAt.toISOString(), metrics: [], anomalies: [] },
          status: {
            source,
            state: "UNAVAILABLE",
            enabled: false,
            dataOrigin: "LIVE",
            lastAttemptAt: startedAt.toISOString(),
            metricCount: 0,
            anomalyCount: 0,
            errorCode: "ADAPTER_NOT_REGISTERED",
            message: `${source} adapter is not registered; no sample data was substituted.`
          }
        });
      }
    }

    const connectors = outputs.map(output => output.status).sort((a, b) => CONNECTOR_SOURCES.indexOf(a.source) - CONNECTOR_SOURCES.indexOf(b.source));
    const metrics = outputs.flatMap(output => output.sample.metrics);
    const anomalies = outputs.flatMap(output => output.sample.anomalies);
    const generatedAt = this.now();
    return {
      mode: this.mode,
      generatedAt: generatedAt.toISOString(),
      expiresAt: new Date(generatedAt.getTime() + this.cacheTtlMs).toISOString(),
      overallHealth: overallHealth(this.mode, connectors, metrics, anomalies),
      cache: { hit: false, ttlSeconds: Math.round(this.cacheTtlMs / 1_000) },
      connectors,
      metrics,
      anomalies
    };
  }

  private async collectAdapter(adapter: TelemetryConnectorAdapter, attemptedAt: Date) {
    try {
      const incoming = await adapter.collect();
      const sample: TelemetryConnectorSample = {
        source: adapter.source,
        collectedAt: incoming.collectedAt,
        metrics: incoming.metrics
          .filter(item => Number.isFinite(item.value))
          .map(item => ({ ...item, source: adapter.source, dataOrigin: "LIVE" as const })),
        anomalies: incoming.anomalies.map(item => ({ ...item, source: adapter.source, dataOrigin: "LIVE" as const })),
        ...(incoming.warnings?.length ? { warnings: incoming.warnings.slice(0, 10) } : {})
      };
      this.lastSuccess.set(adapter.source, { at: attemptedAt.getTime(), sample: structuredClone(sample) });
      const allStale = sample.metrics.length + sample.anomalies.length > 0 && [...sample.metrics, ...sample.anomalies].every(item => item.stale);
      const status: TelemetryConnectorStatus = {
        source: adapter.source,
        state: allStale ? "STALE" : "CONNECTED",
        enabled: true,
        dataOrigin: "LIVE",
        lastAttemptAt: attemptedAt.toISOString(),
        lastSuccessAt: attemptedAt.toISOString(),
        metricCount: sample.metrics.length,
        anomalyCount: sample.anomalies.length,
        ...(sample.warnings?.length ? { warnings: sample.warnings } : {}),
        message: allStale
          ? "Vendor API responded, but every returned observation is stale."
          : sample.warnings?.length
            ? "Live connector refresh partially succeeded; see sanitized warnings."
            : "Live connector refresh succeeded."
      };
      return { sample, status };
    } catch (unknownError) {
      const error = unknownError instanceof TelemetryConnectorError
        ? unknownError
        : new TelemetryConnectorError(adapter.source, "CONNECTOR_FAILURE", "ERROR", true, `${adapter.source} live connector failed.`);
      const previous = this.lastSuccess.get(adapter.source);
      if (error.connectorState === "ERROR" && previous && attemptedAt.getTime() - previous.at <= this.staleRetentionMs) {
        const sample = markSampleStale(previous.sample, attemptedAt);
        const status: TelemetryConnectorStatus = {
          source: adapter.source,
          state: "STALE",
          enabled: error.enabled,
          dataOrigin: "LIVE",
          lastAttemptAt: attemptedAt.toISOString(),
          lastSuccessAt: new Date(previous.at).toISOString(),
          metricCount: sample.metrics.length,
          anomalyCount: sample.anomalies.length,
          errorCode: error.code,
          message: "Live refresh failed; showing the last successful sample as stale."
        };
        return { sample, status };
      }
      const status: TelemetryConnectorStatus = {
        source: adapter.source,
        state: error.connectorState,
        enabled: error.enabled,
        dataOrigin: "LIVE",
        lastAttemptAt: attemptedAt.toISOString(),
        metricCount: 0,
        anomalyCount: 0,
        errorCode: error.code,
        message: error.message
      };
      return { sample: { source: adapter.source, collectedAt: attemptedAt.toISOString(), metrics: [], anomalies: [] }, status };
    }
  }
}

export function createTelemetryAggregator(options: TelemetryAggregatorOptions) {
  return new TelemetryAggregator(options);
}

/** Safe environment parser: only an explicit LIVE value enables vendor polling. */
export function telemetryModeFromEnvironment(value = process.env.TELEMETRY_MODE): OperatingMode {
  return String(value || "").trim().toUpperCase() === "LIVE" ? "LIVE" : "SIMULATION";
}
