import * as grpc from "@grpc/grpc-js";
import { redactOperationalText, type AgentEvidenceMessage, type AgentEvidenceReceipt } from "./engineering-orchestrator.ts";

/** Simulation-only recipient. Real adapters must authorize incident/persona access independently. */
export function simulationEvidenceHandler(token: string) {
  return (call: grpc.ServerUnaryCall<AgentEvidenceMessage, AgentEvidenceReceipt>, callback: grpc.sendUnaryData<AgentEvidenceReceipt>) => {
    const fail = (code: number, message: string) => callback({ code, message } as grpc.ServiceError);
    if (!token || String(call.metadata.get("authorization")[0] || "") !== `Bearer ${token}`) return fail(grpc.status.UNAUTHENTICATED, "Invalid service identity.");
    const request = call.request;
    const personas = ["NETWORK", "WINDOWS", "CLOUDOPS", "DEVOPS", "LINUX", "CLOUDOPS_DEVOPS", "SECURITY", "DATABASE", "MIDDLEWARE"];
    if (!request || ![request.incidentId, request.workflowId, request.correlationId].every(v => /^[A-Za-z0-9_.:-]{1,160}$/.test(v || "")) || !personas.includes(request.sender) || !personas.includes(request.recipient) || request.sender === request.recipient) return fail(grpc.status.INVALID_ARGUMENT, "Invalid collaboration binding.");
    try {
      const evidence = JSON.parse(request.evidenceJson);
      const actions = JSON.parse(request.candidateActionsJson);
      if (!Array.isArray(evidence) || evidence.length > 20 || !Array.isArray(actions) || actions.length > 9) throw new Error();
      const safe = (value: unknown): boolean => typeof value === "string" ? redactOperationalText(value, value.length + 1) === value
        : Array.isArray(value) ? value.every(safe)
        : value && typeof value === "object" ? Object.values(value).every(safe) : true;
      if (!safe(evidence) || !safe(actions)) throw new Error();
      if (evidence.some(e => !e || e.incidentId !== request.incidentId || e.workflowId !== request.workflowId)) throw new Error();
      if (actions.some(a => !a || a.kind !== "READ_ONLY_INVESTIGATION" || a.executable !== false || !personas.includes(a.persona))) throw new Error();
    } catch { return fail(grpc.status.INVALID_ARGUMENT, "Evidence must be redacted, incident-bound, and investigation-only."); }
    callback(null, { incidentId: request.incidentId, workflowId: request.workflowId, correlationId: request.correlationId, recipient: request.recipient, status: "SIMULATED" });
  };
}
