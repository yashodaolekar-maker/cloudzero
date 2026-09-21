import assert from "node:assert/strict";
import test from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";

test("HTTP collaboration persists evidence and restores its workflow after restart", { timeout: 90_000 }, async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "cloudzero-collaboration-test-"));
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const prefix = "/api/engineering/incidents/INC-2026-1013";
  let child: ChildProcess | undefined;
  let logs = "";
  const start = async () => {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE"]) if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, { NODE_ENV: "production", DEPLOYMENT_PROFILE: "LOCAL_SIMULATION", PORT: String(port),
      INCIDENT_DATA_DIR: dataRoot, KNOWLEDGE_INDEX_DIR: dataRoot, KNOWLEDGE_INDEX_REQUIRED: "false",
      OPERATING_MODE: "SIMULATION", TELEMETRY_MODE: "SIMULATION", DIGITAL_TWIN_WORKER_ENABLED: "false",
      ENABLE_LOCAL_PERSONA: "true", AUTH_REQUIRED: "false", AUTO_GENERATE_INCIDENT_VOICE: "false", ENABLE_LIVE_EXECUTION: "false" });
    env.TWIN_METRICS_TOKEN = "test-only-metrics";
    child = spawn(process.execPath, ["--import", "tsx", "server.ts"], { cwd: process.cwd(), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", chunk => { logs = (logs + chunk).slice(-5000); });
    child.stderr?.on("data", chunk => { logs = (logs + chunk).slice(-5000); });
    for (let i = 0; i < 300; i++) {
      if (child.exitCode !== null) throw new Error(`Smoke server exited: ${logs}`);
      if (await fetch(`${base}/readyz`).then(r => r.ok).catch(() => false)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Smoke server did not become ready: ${logs}`);
  };
  const stop = async () => {
    if (child && child.exitCode === null) {
      const closed = once(child, "exit"); child.kill(); await closed;
    }
  };
  const post = async (route: string, body = {}) => {
    const response = await fetch(`${base}${prefix}/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json();
    assert.ok(response.ok, JSON.stringify(value));
    return value;
  };
  try {
    await start();
    const prepared = await post("prepare");
    assert.equal(prepared.created, true);
    const result = await post("collaborate", { workflowId: prepared.workflow.id });
    assert.equal(result.disposition, "ABSTAIN");
    assert.equal(result.workNoteStatus, "SIMULATED");
    assert.ok(result.participants.includes("CLOUDOPS"));
    assert.ok(result.evidence.length > 0);
    const overview = await fetch(`${base}/api/observability?mode=SIMULATION`).then(r=>r.json());
    assert.ok(overview.tasks.some((t:any)=>t.kind==='A2A'));
    assert.equal(overview.summary.accuracy,null);
    assert.equal(overview.policy.incidentSeconds.P1.resolution,3600);
    assert.equal(overview.journeys.summary.sessions,0);
    const recorded = overview.tasks.find((t:any)=>t.decisionEventId);
    const review = { taskId:recorded.id,decisionEventId:recorded.decisionEventId,verdict:'WRONG',reason:'Test reviewer identifies missing context.',correction:'Request incident-bound evidence before validation.',trainingEligible:true };
    const reviewResponse = await fetch(`${base}/api/observability/reviews`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(review)});
    assert.equal(reviewResponse.status,201);
    const mismatch = await fetch(`${base}/api/observability/reviews`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...review,decisionEventId:'unrelated'})});
    assert.equal(mismatch.status,400);
    const exported = await fetch(`${base}/api/observability/training-export`).then(r=>r.text());
    assert.ok(exported.includes('Request incident-bound evidence'));
    assert.equal((await fetch(`${base}/metrics/twins`)).status,401);
    const metrics = await fetch(`${base}/metrics/twins`,{headers:{Authorization:'Bearer test-only-metrics'}}).then(r=>r.text());
    assert.ok(metrics.includes('cloudzero_incident_resolution_sla')); assert.ok(!metrics.includes(recorded.incidentId));
    await stop();
    await start();
    const persisted = await fetch(`${base}/api/observability/tasks/${recorded.id}`).then(r=>r.json());
    assert.equal(persisted.task.review.verdict,'WRONG');
    assert.equal(persisted.reviewHistory.length,1);
    assert.equal((await post("prepare")).created, false);
    const repeated = await post("collaborate", { workflowId: prepared.workflow.id });
    const state = await fetch(`${base}${prefix}/collaboration`).then(r => r.json());
    const requested = state.events.find((e: any) => e.type === "AgentEvidenceExchangeRequested" && e.payload.collaborationId === repeated.collaborationId);
    assert.ok(JSON.parse(requested.payload.evidenceJson).some((e: any) => e.id === result.evidence[0].id));
    assert.ok(state.events.some((e: any) => e.type === "AgentCollaborationWorkNote" && e.payload.note === result.workNote));
    assert.ok(state.events.some((e: any) => e.type === "AgentValidationReplied" && e.payload.inReplyTo));
    assert.ok(state.events.some((e: any) => e.type === "AgentOwnerAssessmentCompleted" && e.payload.collaborationId === result.collaborationId));
    const takeover = await fetch(`${base}/api/engineering/incidents/INC-2026-1013/takeover`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidentId: "INC-2026-1013" })
    });
    const taken = await takeover.json();
    assert.equal(takeover.status, 200, JSON.stringify(taken));
    assert.ok(taken.investigation.evidence.length > 0, "Takeover must collect evidence, not only assign the ticket");
    assert.equal(taken.workflowId, prepared.workflow.id);
    assert.ok(taken.incident.workNotes.some((note: any) => note.text === taken.investigation.workNote));
  } finally {
    await stop();
    const resolved = path.resolve(dataRoot);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("cloudzero-collaboration-test-")) throw new Error("Unexpected test cleanup path.");
    await rm(resolved, { recursive: true, force: true });
  }
});
