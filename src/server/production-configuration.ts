export type ConfigurationState = "READY" | "DISABLED" | "INCOMPLETE";

export interface IntegrationReadiness {
  id: string;
  label: string;
  enabled: boolean;
  state: ConfigurationState;
  missing: string[];
  settings: string[];
  secretNames: string[];
  connectionPath: "DIRECT_READ_ONLY" | "GRPC_PROXY" | "PLATFORM";
}

const externallyManagedSecrets = new Set(["DATABASE_URL", "SERVICENOW_ACCESS_TOKEN", "SERVICENOW_WORK_NOTE_ACCESS_TOKEN", "SOLARWINDS_USERNAME", "SOLARWINDS_PASSWORD", "SOLARWINDS_ACCESS_TOKEN", "CISCO_CATALYST_CENTER_USERNAME", "CISCO_CATALYST_CENTER_PASSWORD", "CISCO_SDWAN_USERNAME", "CISCO_SDWAN_PASSWORD", "COMMAND_PROXY_ACCESS_TOKEN", "FIREWALL_CONNECTOR_CREDENTIALS"]);
const present = (name: string) => Boolean(String(process.env[name] || "").trim()) ||
  (externallyManagedSecrets.has(name) && ["GCP_SECRET_MANAGER", "FILE"].includes(String(process.env.SECRET_PROVIDER || "")));

function integration(args: Omit<IntegrationReadiness, "state" | "missing"> & { required: string[] }) {
  const missing = args.enabled ? args.required.filter(name => !present(name)) : [];
  return { ...args, missing, state: !args.enabled ? "DISABLED" as const : missing.length ? "INCOMPLETE" as const : "READY" as const };
}

export function productionIntegrationReadiness(): IntegrationReadiness[] {
  return [
    integration({ id: "identity", label: "OIDC identity provider", enabled: process.env.AUTH_REQUIRED === "true", required: ["OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URI"], settings: ["AUTH_REQUIRED", "OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URI", "OIDC_ROLE_CLAIM", "OIDC_ALLOWED_ALGORITHMS", "OIDC_CLOCK_TOLERANCE_SECONDS"], secretNames: [], connectionPath: "PLATFORM" }),
    integration({ id: "ledger", label: "PostgreSQL immutable ledger", enabled: true, required: ["DATABASE_URL"], settings: ["DATABASE_URL", "DATABASE_SSL_MODE", "DATABASE_POOL_MAX"], secretNames: ["DATABASE_URL"], connectionPath: "PLATFORM" }),
    integration({ id: "servicenow", label: "ServiceNow ITSM and CMDB", enabled: process.env.SERVICENOW_INCIDENT_INGEST_ENABLED === "true" || process.env.ENABLE_SERVICENOW_WORK_NOTES === "true", required: ["SERVICENOW_INSTANCE_URL", ...(process.env.SERVICENOW_INCIDENT_INGEST_ENABLED === "true" ? ["SERVICENOW_ACCESS_TOKEN"] : []), ...(process.env.ENABLE_SERVICENOW_WORK_NOTES === "true" ? ["SERVICENOW_WORK_NOTE_ACCESS_TOKEN"] : [])], settings: ["SERVICENOW_INCIDENT_INGEST_ENABLED", "ENABLE_SERVICENOW_WORK_NOTES", "SERVICENOW_INSTANCE_URL", "SERVICENOW_ASSIGNMENT_GROUP", "SERVICENOW_ASSIGNED_TO", "SERVICENOW_CMDB_CLASS_ALLOWLIST"], secretNames: ["SERVICENOW_ACCESS_TOKEN", "SERVICENOW_WORK_NOTE_ACCESS_TOKEN"], connectionPath: "DIRECT_READ_ONLY" }),
    integration({ id: "solarwinds", label: "SolarWinds Platform/Orion", enabled: process.env.SOLARWINDS_ENABLED === "true", required: ["SOLARWINDS_API_URL", ...(process.env.SOLARWINDS_AUTH_MODE === "BEARER" ? ["SOLARWINDS_ACCESS_TOKEN"] : ["SOLARWINDS_USERNAME", "SOLARWINDS_PASSWORD"])], settings: ["SOLARWINDS_ENABLED", "SOLARWINDS_API_URL", "SOLARWINDS_AUTH_MODE", "SOLARWINDS_NODE_QUERY"], secretNames: ["SOLARWINDS_USERNAME", "SOLARWINDS_PASSWORD", "SOLARWINDS_ACCESS_TOKEN"], connectionPath: "DIRECT_READ_ONLY" }),
    integration({ id: "catalyst-center", label: "Cisco Catalyst Center (DNAC)", enabled: process.env.CISCO_CATALYST_CENTER_ENABLED === "true", required: ["CISCO_CATALYST_CENTER_URL", "CISCO_CATALYST_CENTER_USERNAME", "CISCO_CATALYST_CENTER_PASSWORD", "COMMAND_PROXY_GRPC_ENDPOINT"], settings: ["CISCO_CATALYST_CENTER_ENABLED", "CISCO_CATALYST_CENTER_URL", "CISCO_CATALYST_CENTER_API_VERSION", "CISCO_CATALYST_CENTER_DEVICE_SCOPE", "CISCO_CATALYST_CENTER_CA_FILE"], secretNames: ["CISCO_CATALYST_CENTER_USERNAME", "CISCO_CATALYST_CENTER_PASSWORD"], connectionPath: "GRPC_PROXY" }),
    integration({ id: "cisco-sdwan", label: "Cisco Catalyst SD-WAN Manager", enabled: process.env.CISCO_SDWAN_ENABLED === "true", required: ["CISCO_SDWAN_URL", "CISCO_SDWAN_USERNAME", "CISCO_SDWAN_PASSWORD", "COMMAND_PROXY_GRPC_ENDPOINT"], settings: ["CISCO_SDWAN_ENABLED", "CISCO_SDWAN_URL", "CISCO_SDWAN_AUTH_MODE", "CISCO_SDWAN_TENANT", "CISCO_SDWAN_CA_FILE"], secretNames: ["CISCO_SDWAN_USERNAME", "CISCO_SDWAN_PASSWORD"], connectionPath: "GRPC_PROXY" }),
    integration({ id: "firewalls", label: "Firewall managers (FMC/Panorama/FortiManager)", enabled: process.env.FIREWALL_CONNECTORS_ENABLED === "true", required: ["FIREWALL_MANAGER_TYPES", "COMMAND_PROXY_GRPC_ENDPOINT", "COMMAND_PROXY_ACCESS_TOKEN"], settings: ["FIREWALL_CONNECTORS_ENABLED", "FIREWALL_MANAGER_TYPES", "FIREWALL_DEVICE_SCOPE", "FIREWALL_CA_BUNDLE_FILE"], secretNames: ["FIREWALL_CONNECTOR_CREDENTIALS"], connectionPath: "GRPC_PROXY" }),
    integration({ id: "command-proxy", label: "Governed command proxy", enabled: true, required: ["COMMAND_PROXY_GRPC_ENDPOINT", "COMMAND_PROXY_ACCESS_TOKEN", ...(process.env.OPERATING_MODE === "LIVE" ? ["COMMAND_PROXY_CA_FILE", "COMMAND_PROXY_CLIENT_CERT_FILE", "COMMAND_PROXY_CLIENT_KEY_FILE"] : [])], settings: ["COMMAND_PROXY_GRPC_ENDPOINT", "COMMAND_PROXY_TIMEOUT_MS", "COMMAND_PROXY_CA_FILE", "COMMAND_PROXY_CLIENT_CERT_FILE", "COMMAND_PROXY_CLIENT_KEY_FILE"], secretNames: ["COMMAND_PROXY_ACCESS_TOKEN", "COMMAND_PROXY_CLIENT_KEY_FILE"], connectionPath: "GRPC_PROXY" })
  ];
}

export function assertProductionIntegrations() {
  if (String(process.env.DEPLOYMENT_PROFILE).toUpperCase() !== "PRODUCTION") return;
  const incomplete = productionIntegrationReadiness().filter(item => item.state === "INCOMPLETE");
  if (incomplete.length) throw new Error(`Refusing unsafe PRODUCTION startup: incomplete integrations: ${incomplete.map(item => `${item.id}(${item.missing.join(",")})`).join("; ")}.`);
}
