import { GoogleAuth } from "google-auth-library";
import type { SecretProvider } from "./secrets.ts";

export interface ExternalSignal {
  externalId: string;
  source: "ServiceNow" | "GoogleCloudMonitoring";
  severity: string;
  summary: string;
  observedAt: string;
  resource: string;
  raw: Record<string, unknown>;
}

export class ServiceNowReadConnector {
  constructor(private readonly secrets: SecretProvider) {}

  async incidents(limit = 20): Promise<ExternalSignal[]> {
    const instance = (await this.secrets.get("SERVICENOW_INSTANCE_URL"))?.replace(/\/$/, "");
    const token = await this.secrets.get("SERVICENOW_ACCESS_TOKEN");
    if (!instance || !token) throw new Error("ServiceNow read connector is not configured.");
    const target = new URL(instance);
    if (target.protocol !== "https:" && target.hostname !== "localhost" && target.hostname !== "127.0.0.1") {
      throw new Error("ServiceNow read access requires HTTPS unless the instance is localhost.");
    }
    const scopedValue = (name: string) => {
      const value = String(process.env[name] || "").trim();
      if (!value) return "";
      if (!/^[A-Za-z0-9 _.@-]{1,100}$/.test(value)) throw new Error(`${name} contains unsupported query characters.`);
      return value;
    };
    const assignedTo = scopedValue("SERVICENOW_ASSIGNED_TO");
    const assignmentGroup = scopedValue("SERVICENOW_ASSIGNMENT_GROUP");
    const queryParts = ["active=true"];
    if (assignedTo) queryParts.push(`assigned_to=${assignedTo}`);
    if (assignmentGroup) queryParts.push(`assignment_group=${assignmentGroup}`);
    queryParts.push("ORDERBYDESCsys_updated_on");
    const query = new URLSearchParams({
      sysparm_limit: String(Math.min(Math.max(limit, 1), 100)),
      sysparm_query: queryParts.join("^"),
      sysparm_fields: "sys_id,number,short_description,description,caused_by,priority,state,assigned_to,assignment_group,cmdb_ci,cmdb_ci.sys_class_name,opened_at,resolved_at,closed_at,sys_updated_on,location,caller_id,u_region,u_country,u_location"
    });
    const response = await fetch(`${instance}/api/now/table/incident?${query}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`ServiceNow read failed with HTTP ${response.status}.`);
    const body: any = await response.json();
    const fieldValue = (value: unknown) => {
      if (value && typeof value === "object") {
        const field = value as Record<string, unknown>;
        return field.value ?? field.display_value ?? "";
      }
      return value ?? "";
    };
    return (body.result || []).map((row: any) => ({
      externalId: String(fieldValue(row.number) || fieldValue(row.sys_id)),
      source: "ServiceNow",
      severity: String(fieldValue(row.priority) || "unknown"),
      summary: String(fieldValue(row.short_description) || "ServiceNow incident"),
      observedAt: String(fieldValue(row.sys_updated_on) || fieldValue(row.opened_at) || new Date().toISOString()),
      resource: String(fieldValue(row.cmdb_ci) || "unknown"),
      raw: row
    }));
  }
}

/**
 * Purpose-built writer for one field only. It cannot change incident state,
 * ownership, priority, configuration items, or any other ServiceNow data.
 */
export class ServiceNowWorkNoteWriter {
  constructor(private readonly secrets: SecretProvider) {}

  async appendEnglishNote(incidentNumber: string, note: string) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(incidentNumber)) {
      throw new Error("ServiceNow incident number contains unsupported characters.");
    }
    if (!note.trim() || note.length > 4_000 || !/^[\x09\x0A\x0D\x20-\x7E]+$/.test(note)) {
      throw new Error("ServiceNow audit work note must be non-empty English-compatible text under 4,000 characters.");
    }

    const instance = (await this.secrets.get("SERVICENOW_INSTANCE_URL"))?.replace(/\/$/, "");
    const token = await this.secrets.get("SERVICENOW_WORK_NOTE_ACCESS_TOKEN");
    if (!instance || !token) throw new Error("ServiceNow work-note writer is not configured.");
    const parsed = new URL(instance);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new Error("ServiceNow write access requires HTTPS unless the instance is localhost.");
    }

    const query = new URLSearchParams({
      sysparm_limit: "1",
      sysparm_query: `number=${incidentNumber}`,
      sysparm_fields: "sys_id"
    });
    const lookup = await fetch(`${instance}/api/now/table/incident?${query}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000)
    });
    if (!lookup.ok) throw new Error(`ServiceNow incident lookup failed with HTTP ${lookup.status}.`);
    const body: any = await lookup.json();
    const sysId = String(body?.result?.[0]?.sys_id || "");
    if (!/^[a-fA-F0-9]{32}$/.test(sysId)) throw new Error(`ServiceNow incident ${incidentNumber} was not found.`);

    const update = await fetch(`${instance}/api/now/table/incident/${sysId}`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ work_notes: note }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!update.ok) throw new Error(`ServiceNow work-note update failed with HTTP ${update.status}.`);
    return { incidentNumber, sysId };
  }
}

export class GoogleMonitoringReadConnector {
  private readonly auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/monitoring.read"] });
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(private readonly options: {
    /** Non-secret resource selection. Credentials continue to come from Google ADC. */
    projectId?: string;
    metricType?: string;
    fetchImpl?: typeof fetch;
    accessTokenProvider?: () => Promise<string>;
    now?: () => Date;
    timeoutMs?: number;
  } = {}) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.now = options.now || (() => new Date());
    const requestedTimeout = Number(options.timeoutMs ?? 12_000);
    this.timeoutMs = Number.isFinite(requestedTimeout) ? Math.min(Math.max(requestedTimeout, 1_000), 30_000) : 12_000;
  }

  async signals(limit = 20): Promise<ExternalSignal[]> {
    const projectId = this.options.projectId || process.env.GOOGLE_CLOUD_PROJECT;
    if (!projectId) throw new Error("GOOGLE_CLOUD_PROJECT is not configured.");
    const accessToken = this.options.accessTokenProvider
      ? await this.options.accessTokenProvider()
      : await (async () => {
          const client = await this.auth.getClient();
          const token = await client.getAccessToken();
          return typeof token === "string" ? token : token.token;
        })();
    if (!accessToken) throw new Error("Google Cloud Monitoring access token is unavailable.");
    const end = this.now();
    const start = new Date(end.getTime() - 15 * 60 * 1000);
    const metricType = this.options.metricType || process.env.GOOGLE_MONITORING_METRIC_TYPE || "compute.googleapis.com/instance/cpu/utilization";
    const params = new URLSearchParams({
      filter: `metric.type="${metricType}"`,
      "interval.startTime": start.toISOString(),
      "interval.endTime": end.toISOString(),
      view: "FULL",
      pageSize: String(Math.min(Math.max(limit, 1), 100))
    });
    const response = await this.fetchImpl(`https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`Cloud Monitoring read failed with HTTP ${response.status}.`);
    const body: any = await response.json();
    return (body.timeSeries || []).map((series: any, index: number) => ({
      externalId: `${metricType}:${series.resource?.labels?.instance_id || index}`,
      source: "GoogleCloudMonitoring",
      severity: "telemetry",
      summary: `${metricType} latest value ${JSON.stringify(series.points?.[0]?.value || {})}`,
      observedAt: String(series.points?.[0]?.interval?.endTime || new Date().toISOString()),
      resource: String(series.resource?.labels?.instance_id || series.resource?.type || "unknown"),
      raw: series
    }));
  }
}
