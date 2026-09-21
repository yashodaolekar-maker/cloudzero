import path from "node:path";
import crypto from "node:crypto";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { simulationEvidenceHandler } from "./agent-exchange-simulator.ts";
import { DemoDatabase } from "./demo-database.ts";

const allowedTemplates = new Set([
  'CLOUD_RESOURCE_HEALTH','MIDDLEWARE_QUEUE_HEALTH',
  "DATABASE_CONNECTION_HEALTH",
  "LINUX_SERVICE_FAILURES", "LINUX_NETWORK_VALIDATION", "LINUX_RECENT_ERRORS", "DEVOPS_RECENT_EVENTS",
  "NETWORK_INTERFACE_SUMMARY", "NETWORK_BGP_SUMMARY", "WINDOWS_SERVICE_STATUS",
  "NETWORK_ACCESS_VLAN", "NETWORK_PATH_MTU", "WINDOWS_KERBEROS_VALIDATION", "WINDOWS_IIS_VALIDATION",
  "NETWORK_ROUTE_SUMMARY", "NETWORK_NEIGHBOR_SUMMARY", "NETWORK_FIREWALL_SESSION_SUMMARY",
  "NETWORK_WIRELESS_CLIENT_SUMMARY", "NETWORK_SDWAN_CONTROL_SUMMARY",
  "WINDOWS_NETWORK_VALIDATION", "WINDOWS_DNS_VALIDATION",
  "WINDOWS_RECENT_SYSTEM_ERRORS", "KUBERNETES_WORKLOAD_STATUS",
  "KUBERNETES_RECENT_EVENTS", "SECURITY_AUTH_FAILURES", "SECURITY_THREAT_INDICATORS"
]);
const token = String(process.env.COMMAND_PROXY_ACCESS_TOKEN || "");
const demo = process.env.ENABLE_A2A_DB_DEMO === "true" && process.env.DEMO_DATABASE_URL ? new DemoDatabase(process.env.DEMO_DATABASE_URL) : null;
if (!token || token.length < 16) throw new Error("Local command proxy requires a non-empty simulation token of at least 16 characters.");

const definition = protoLoader.loadSync(path.resolve(process.cwd(), "proto", "command_proxy.proto"), {
  keepCase: false, longs: String, enums: String, defaults: true, oneofs: true
});
const service = (grpc.loadPackageDefinition(definition) as any).cloudzero.commandproxy.v1.CommandProxy.service;
const server = new grpc.Server({ "grpc.max_receive_message_length": 64 * 1024, "grpc.max_send_message_length": 1024 * 1024 });
const simulatedObservations: Record<string, string> = {
  NETWORK_INTERFACE_SUMMARY: "SIMULATION: interface inventory returned; administrative and operational state require a configured device adapter for validation.",
  NETWORK_ACCESS_VLAN: "SIMULATION: access-port switchport state requested; no switch configuration was read from a device.",
  NETWORK_PATH_MTU: "SIMULATION: path MTU probe requested; no packet was sent to a device.",
  NETWORK_ROUTE_SUMMARY: "SIMULATION: route summary requested; forwarding state was not read from a device.",
  NETWORK_BGP_SUMMARY: "SIMULATION: BGP neighbor summary requested; adjacency state was not read from a router.",
  NETWORK_NEIGHBOR_SUMMARY: "SIMULATION: neighbor discovery requested; switch adjacency was not read from a device.",
  NETWORK_FIREWALL_SESSION_SUMMARY: "SIMULATION: flow/session lookup requested; no firewall session or policy decision was read.",
  NETWORK_WIRELESS_CLIENT_SUMMARY: "SIMULATION: wireless client detail requested; no WLC or access-point state was read.",
  NETWORK_SDWAN_CONTROL_SUMMARY: "SIMULATION: SD-WAN control connections requested; no edge or controller state was read.",
  WINDOWS_RECENT_SYSTEM_ERRORS: "SIMULATION: Windows System error query requested; no host Event Log was read.",
  WINDOWS_NETWORK_VALIDATION: "SIMULATION: Windows addressing, route and reachability checks requested; no host command was run.",
  WINDOWS_DNS_VALIDATION: "SIMULATION: Windows resolver checks requested; no host command was run.",
  WINDOWS_KERBEROS_VALIDATION: "SIMULATION: Windows time, Kerberos ticket and secure-channel checks requested; no host command was run.",
  WINDOWS_IIS_VALIDATION: "SIMULATION: IIS application-pool and website state requested; no host command was run.",
  LINUX_SERVICE_FAILURES: "SIMULATION: failed-service query requested; no Linux host state was read.",
  LINUX_RECENT_ERRORS: "SIMULATION: recent journal errors requested; no Linux journal was read.",
  LINUX_NETWORK_VALIDATION: "SIMULATION: Linux address, route, resolver and TCP checks requested; no host command was run."
};

server.addService(service, {
  exchangeEvidence: simulationEvidenceHandler(token),
  executeCommand(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) {
    const authorization = String(call.metadata.get("authorization")[0] || "");
    if (authorization !== `Bearer ${token}`) return callback({ code: grpc.status.UNAUTHENTICATED, message: "Invalid service identity." } as grpc.ServiceError);
    const request = call.request || {};
    if (!allowedTemplates.has(String(request.templateId || ""))) return callback({ code: grpc.status.PERMISSION_DENIED, message: "Template is not allowlisted." } as grpc.ServiceError);
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(String(request.incidentId || "")) || !/^[A-Za-z0-9_.:-]{1,160}$/.test(String(request.workflowId || "")) || !/^[A-Za-z0-9_.:-]{1,160}$/.test(String(request.deviceId || ""))) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: "Invalid execution binding." } as grpc.ServiceError);
    }
    const correlationId = String(request.correlationId || "");
    if (String(request.deviceId).startsWith("demo-ci-")) {
      if (!demo) return callback({code:grpc.status.UNAVAILABLE,message:"Demo database is not configured."} as grpc.ServiceError);
      demo.diagnose(request).then(result=>callback(null,result)).catch(()=>callback({code:grpc.status.FAILED_PRECONDITION,message:"Demo query failed or its session binding is invalid."} as grpc.ServiceError));
      return;
    }
    if (['DATABASE_CONNECTION_HEALTH','CLOUD_RESOURCE_HEALTH','MIDDLEWARE_QUEUE_HEALTH'].includes(request.templateId)) return callback({code:grpc.status.PERMISSION_DENIED,message:"This diagnostic requires a configured adapter."} as grpc.ServiceError);
    callback(null, {
      executionId: crypto.randomUUID(),
      status: "SIMULATED",
      output: simulatedObservations[request.templateId] || `Proxy simulation completed for ${request.templateId}; no private device connection was made.`,
      observedAt: new Date().toISOString(),
      proxyAuditId: `grpc-sim-${correlationId}`
    });
  },
  streamTelemetry(call: grpc.ServerWritableStream<any, any>) {
    call.emit("error", { code: grpc.status.UNIMPLEMENTED, message: "Telemetry streaming is supplied by configured monitoring connectors." });
  }
});

async function start() {
if (demo) await demo.initialize();
server.bindAsync("0.0.0.0:50051", grpc.ServerCredentials.createInsecure(), (error) => {
  if (error) throw error;
  console.log("CloudZero local command proxy listening on gRPC port 50051 (simulation only).");
});
}
start().catch(error=>{console.error("Command proxy startup failed:",error.message);process.exitCode=1;});
process.on("SIGTERM",()=>{server.tryShutdown(()=>{void demo?.close().finally(()=>process.exit(0));if(!demo)process.exit(0);});});
