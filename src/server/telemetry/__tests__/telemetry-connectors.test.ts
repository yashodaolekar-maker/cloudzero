import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedTelemetryMetric, TelemetryConnectorSource } from "../../../types.ts";
import type { SecretProvider } from "../../secrets.ts";
import {
  DatadogTelemetryAdapter,
  GoogleCloudMonitoringTelemetryAdapter,
  SolarWindsTelemetryAdapter,
  SplunkTelemetryAdapter,
  TelemetryAggregator,
  TelemetryConnectorError,
  telemetryModeFromEnvironment,
  type TelemetryConnectorAdapter
} from "../../telemetry-connectors.ts";

class MapSecrets implements SecretProvider {
  constructor(private readonly values: Record<string, string | undefined> = {}) {}
  async get(name: string) {
    return this.values[name];
  }
}

const fixedNow = new Date("2026-09-04T10:00:00.000Z");

test("telemetry mode requires an explicit LIVE value", () => {
  assert.equal(telemetryModeFromEnvironment("LIVE"), "LIVE");
  assert.equal(telemetryModeFromEnvironment("live"), "LIVE");
  assert.equal(telemetryModeFromEnvironment(undefined), "SIMULATION");
  assert.equal(telemetryModeFromEnvironment("unexpected"), "SIMULATION");
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("SIMULATION never calls vendor adapters and marks every sample as synthetic", async () => {
  let vendorCalls = 0;
  const forbiddenAdapter: TelemetryConnectorAdapter = {
    source: "DATADOG",
    async collect() {
      vendorCalls += 1;
      throw new Error("must not run");
    }
  };
  const aggregator = new TelemetryAggregator({
    secrets: new MapSecrets(),
    mode: "SIMULATION",
    adapters: [forbiddenAdapter],
    now: () => fixedNow
  });

  const snapshot = await aggregator.collect();

  assert.equal(vendorCalls, 0);
  assert.equal(snapshot.mode, "SIMULATION");
  assert.equal(snapshot.connectors.length, 4);
  assert.ok(snapshot.connectors.every(item => item.state === "SIMULATED" && item.dataOrigin === "SIMULATION"));
  assert.ok(snapshot.connectors.every(item => /no vendor API/i.test(item.message)));
  assert.ok(snapshot.metrics.length > 0);
  assert.ok(snapshot.metrics.every(item => item.dataOrigin === "SIMULATION"));
  assert.ok(snapshot.anomalies.every(item => item.dataOrigin === "SIMULATION"));
});

test("LIVE with missing configuration returns UNAVAILABLE without fake metrics", async () => {
  const aggregator = new TelemetryAggregator({
    secrets: new MapSecrets(),
    mode: "LIVE",
    now: () => fixedNow
  });

  const snapshot = await aggregator.collect();

  assert.equal(snapshot.mode, "LIVE");
  assert.equal(snapshot.metrics.length, 0);
  assert.equal(snapshot.anomalies.length, 0);
  assert.equal(snapshot.overallHealth, "UNKNOWN");
  assert.ok(snapshot.connectors.every(item => item.state === "UNAVAILABLE"));
  assert.ok(snapshot.connectors.every(item => item.enabled === false));
  assert.ok(snapshot.connectors.every(item => item.errorCode === "CONNECTOR_DISABLED"));
});

test("Datadog uses injected secrets and normalizes metrics plus security signals", async () => {
  const requests: Array<{ url: URL; headers: Headers }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, headers: new Headers(init?.headers) });
    if (url.pathname === "/api/v2/security_monitoring/signals") {
      return jsonResponse({
        data: [{
          id: "signal-1",
          attributes: {
            timestamp: fixedNow.toISOString(),
            severity: "high",
            message: "Suspicious process and network behavior correlated.",
            security_rule: { name: "Possible lateral movement", type: "workload_security" },
            tags: ["host:router-api-01", "env:production"]
          }
        }]
      });
    }
    const query = url.searchParams.get("query") || "";
    const value = query.includes("cpu") ? 52 : query.includes("duration") ? 3 : 2_516;
    return jsonResponse({
      series: [{
        metric: "example.metric",
        scope: "host:router-api-01",
        tag_set: ["host:router-api-01", "env:production"],
        pointlist: [[fixedNow.getTime() / 1_000, value]]
      }]
    });
  };
  const adapter = new DatadogTelemetryAdapter({
    secrets: new MapSecrets({
      DATADOG_API_KEY: "api-secret",
      DATADOG_APP_KEY: "app-secret"
    }),
    configuration: {
      DATADOG_ENABLED: "true",
      DATADOG_API_URL: "https://api.datadoghq.test",
      DATADOG_SECURITY_SIGNALS_ENABLED: "true"
    },
    fetchImpl,
    now: () => fixedNow
  });

  const result = await adapter.collect();

  assert.equal(requests.length, 4);
  assert.ok(requests.every(item => item.url.protocol === "https:"));
  assert.ok(requests.every(item => item.headers.get("DD-API-KEY") === "api-secret"));
  assert.deepEqual(result.metrics.map(item => item.value), [2_516, 52, 3]);
  assert.equal(result.metrics[1].health, "HEALTHY");
  assert.equal(result.anomalies.length, 1);
  assert.equal(result.anomalies[0].severity, "HIGH");
  assert.equal(result.anomalies[0].resource.id, "router-api-01");
  assert.ok(!JSON.stringify(result).includes("api-secret"));
  assert.ok(!JSON.stringify(result).includes("app-secret"));
});

test("Splunk accepts export NDJSON and returns a normalized SIEM anomaly", async () => {
  let call = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    call += 1;
    assert.equal(new URL(String(input)).pathname, "/services/search/v2/jobs/export");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer splunk-secret");
    if (call === 1) {
      return new Response(`${JSON.stringify({ result: { value: "42", _time: fixedNow.toISOString(), host: "indexer-01" } })}\n`);
    }
    return new Response(`${JSON.stringify({ result: {
      event_id: "evt-1",
      _time: fixedNow.toISOString(),
      host: "edge-router-01",
      severity: "critical",
      signature: "Command-and-control beacon",
      message: "Repeated callback behavior",
      risk_score: "91"
    } })}\n`);
  };
  const adapter = new SplunkTelemetryAdapter({
    secrets: new MapSecrets({ SPLUNK_ACCESS_TOKEN: "splunk-secret" }),
    configuration: {
      SPLUNK_ENABLED: "true",
      SPLUNK_API_URL: "https://splunk.example.test:8089",
      SPLUNK_ANOMALY_SEARCH_ENABLED: "true"
    },
    fetchImpl,
    now: () => fixedNow
  });

  const result = await adapter.collect();

  assert.equal(call, 2);
  assert.equal(result.metrics[0].value, 42);
  assert.equal(result.anomalies[0].severity, "CRITICAL");
  assert.equal(result.anomalies[0].confidence, 0.91);
  assert.equal(result.anomalies[0].resource.id, "edge-router-01");
});

test("Datadog keeps valid metrics when optional security-signal access is denied", async () => {
  const fetchImpl: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.includes("security_monitoring")) return jsonResponse({ errors: ["forbidden"] }, 403);
    return jsonResponse({
      series: [{ metric: "system.cpu.user", scope: "host:app-1", pointlist: [[fixedNow.getTime() / 1_000, 45]] }]
    });
  };
  const adapter = new DatadogTelemetryAdapter({
    secrets: new MapSecrets({ DATADOG_API_KEY: "api-secret", DATADOG_APP_KEY: "app-secret" }),
    configuration: {
      DATADOG_ENABLED: "true",
      DATADOG_API_URL: "https://api.datadoghq.test",
      DATADOG_SECURITY_SIGNALS_ENABLED: "true",
      DATADOG_METRIC_QUERIES_JSON: JSON.stringify([{ name: "cpu", displayName: "CPU", query: "avg:system.cpu.user{*}", unit: "%", warnAbove: 80 }])
    },
    fetchImpl,
    now: () => fixedNow
  });

  const result = await adapter.collect();

  assert.equal(result.metrics.length, 1);
  assert.equal(result.metrics[0].value, 45);
  assert.equal(result.anomalies.length, 0);
  assert.equal(result.warnings?.[0].code, "AUTHENTICATION_FAILED");
  assert.match(result.warnings?.[0].message || "", /metrics are live/i);
});

test("SolarWinds normalizes node telemetry and emits an outage anomaly", async () => {
  let requestedUrl: URL | undefined;
  let authorization: string | null = null;
  const password = "test-password ";
  const fetchImpl: typeof fetch = async (input, init) => {
    requestedUrl = new URL(String(input));
    authorization = new Headers(init?.headers).get("Authorization");
    return jsonResponse({
      results: [{
        NodeID: 7,
        Caption: "core-router-07",
        Status: 2,
        ResponseTime: 420,
        PercentLoss: 75,
        CPULoad: 97,
        LastSync: fixedNow.toISOString(),
        Location: "Mexico City",
        MachineType: "Router"
      }]
    });
  };
  const adapter = new SolarWindsTelemetryAdapter({
    secrets: new MapSecrets({
      SOLARWINDS_USERNAME: "readonly-operator",
      SOLARWINDS_PASSWORD: password
    }),
    configuration: {
      SOLARWINDS_ENABLED: "true",
      SOLARWINDS_API_URL: "https://solarwinds.example.test/SolarWinds/InformationService/v3/Json"
    },
    fetchImpl,
    now: () => fixedNow
  });

  const result = await adapter.collect();

  assert.match(requestedUrl?.pathname || "", /\/Query$/);
  assert.equal(authorization, `Basic ${Buffer.from(`readonly-operator:${password}`, "utf8").toString("base64")}`);
  assert.equal(result.metrics.length, 3);
  assert.ok(result.metrics.every(item => item.health === "CRITICAL"));
  assert.equal(result.anomalies.length, 1);
  assert.equal(result.anomalies[0].severity, "CRITICAL");
  assert.equal(result.anomalies[0].resource.name, "core-router-07");
  assert.equal(JSON.stringify(result).includes(password), false);
});

test("SolarWinds bearer auth is used only when explicitly selected", async () => {
  let authorization: string | null = null;
  const adapter = new SolarWindsTelemetryAdapter({
    secrets: new MapSecrets({ SOLARWINDS_ACCESS_TOKEN: "relay-token" }),
    configuration: {
      SOLARWINDS_ENABLED: "true",
      SOLARWINDS_API_URL: "https://solarwinds-relay.example.test/swis",
      SOLARWINDS_AUTH_MODE: "BEARER"
    },
    fetchImpl: async (_input, init) => {
      authorization = new Headers(init?.headers).get("Authorization");
      return jsonResponse({ results: [] });
    },
    now: () => fixedNow
  });

  const result = await adapter.collect();

  assert.equal(authorization, "Bearer relay-token");
  assert.deepEqual(result.metrics, []);
  assert.equal(JSON.stringify(result).includes("relay-token"), false);
});

test("Google Cloud Monitoring reuses its read connector and normalizes time-series values", async () => {
  let requestedLimit = 0;
  const adapter = new GoogleCloudMonitoringTelemetryAdapter({
    secrets: new MapSecrets(),
    configuration: {
      GOOGLE_MONITORING_ENABLED: "true",
      GOOGLE_CLOUD_PROJECT: "telemetry-project"
    },
    now: () => fixedNow
  }, {
    async signals(limit) {
      requestedLimit = limit || 0;
      return [{
        externalId: "compute.googleapis.com/instance/cpu/utilization:instance-42",
        source: "GoogleCloudMonitoring",
        severity: "telemetry",
        summary: "CPU utilization",
        observedAt: fixedNow.toISOString(),
        resource: "instance-42",
        raw: {
          metric: { type: "compute.googleapis.com/instance/cpu/utilization", labels: { role: "api" } },
          resource: { type: "gce_instance", labels: { instance_id: "instance-42", zone: "us-central1-a" } },
          points: [{ interval: { endTime: fixedNow.toISOString() }, value: { doubleValue: 0.42 } }]
        }
      }];
    }
  });

  const result = await adapter.collect();

  assert.equal(requestedLimit, 100);
  assert.equal(result.metrics.length, 1);
  assert.equal(result.metrics[0].value, 0.42);
  assert.equal(result.metrics[0].resource.id, "instance-42");
  assert.equal(result.metrics[0].resource.region, "us-central1-a");
  assert.equal(result.metrics[0].health, "UNKNOWN", "no threshold policy means no fabricated health claim");
});

test("non-local HTTP connector URLs are rejected before fetch", async () => {
  let fetchCalled = false;
  const adapter = new DatadogTelemetryAdapter({
    secrets: new MapSecrets({
      DATADOG_API_KEY: "api-secret",
      DATADOG_APP_KEY: "app-secret"
    }),
    configuration: {
      DATADOG_ENABLED: "true",
      DATADOG_API_URL: "http://api.datadoghq.test"
    },
    fetchImpl: async () => {
      fetchCalled = true;
      return jsonResponse({});
    },
    now: () => fixedNow
  });

  await assert.rejects(adapter.collect(), (error: unknown) => {
    assert.ok(error instanceof TelemetryConnectorError);
    assert.equal(error.code, "INSECURE_ENDPOINT");
    return true;
  });
  assert.equal(fetchCalled, false);
});

function liveMetric(source: TelemetryConnectorSource, timestamp: Date): NormalizedTelemetryMetric {
  return {
    id: "metric-1",
    source,
    dataOrigin: "LIVE",
    name: "cpu_utilization_percent",
    displayName: "Compute utilization",
    value: 42,
    unit: "%",
    observedAt: timestamp.toISOString(),
    collectedAt: timestamp.toISOString(),
    ageSeconds: 0,
    freshness: "FRESH",
    stale: false,
    health: "HEALTHY",
    resource: { id: "node-1", type: "host" }
  };
}

test("aggregator caches polling and preserves a failed refresh only as STALE", async () => {
  let current = new Date(fixedNow);
  let calls = 0;
  let fail = false;
  const adapter: TelemetryConnectorAdapter = {
    source: "DATADOG",
    async collect() {
      calls += 1;
      if (fail) throw new TelemetryConnectorError("DATADOG", "UPSTREAM_TIMEOUT", "ERROR", true, "Datadog timed out.");
      return {
        source: "DATADOG",
        collectedAt: current.toISOString(),
        metrics: [liveMetric("DATADOG", current)],
        anomalies: []
      };
    }
  };
  const aggregator = new TelemetryAggregator({
    secrets: new MapSecrets(),
    mode: "LIVE",
    adapters: [adapter],
    now: () => new Date(current),
    cacheTtlMs: 5_000,
    staleRetentionMs: 60_000
  });

  const first = await aggregator.collect();
  current = new Date(current.getTime() + 1_000);
  const cached = await aggregator.collect();

  assert.equal(calls, 1);
  assert.equal(first.cache.hit, false);
  assert.equal(cached.cache.hit, true);

  fail = true;
  current = new Date(current.getTime() + 5_000);
  const stale = await aggregator.collect();

  assert.equal(calls, 2);
  const datadog = stale.connectors.find(item => item.source === "DATADOG");
  assert.equal(datadog?.state, "STALE");
  assert.equal(datadog?.errorCode, "UPSTREAM_TIMEOUT");
  assert.equal(stale.metrics[0].freshness, "STALE");
  assert.equal(stale.metrics[0].stale, true);
  assert.equal(stale.metrics[0].health, "UNKNOWN");
  assert.equal(stale.metrics[0].dataOrigin, "LIVE", "origin remains truthful while freshness is explicitly stale");
  assert.notEqual(stale.overallHealth, "HEALTHY");
});
