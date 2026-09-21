import test from "node:test";
import assert from "node:assert/strict";
import { validateEvidenceState } from "../../evidence-state-guardrail.ts";

const initial = [{ id:"signal", source:"ITSM", summary:"INITIAL_SIGNAL" }];
test("initial signal downgrades ESTABLISHED to suspected / insufficient", () => {
  const result=validateEvidenceState({ evidence:initial, modelProposedState:"ESTABLISHED", modelRemediation:"reconfigure DHCP relay", requiredParticipants:["WINDOWS"] });
  assert.equal(result.validatedEvidenceState,"SUSPECTED"); assert.equal(result.overallRcaState,"INSUFFICIENT_EVIDENCE"); assert.equal(result.remediation.disposition,"BLOCKED_INSUFFICIENT_EVIDENCE"); assert.deepEqual(result.requestedParticipants,["WINDOWS"]);
});
test("initial signal rejects CONFIRMED and permits diagnostics", () => {
  const result=validateEvidenceState({ evidence:initial, modelProposedState:"CONFIRMED", modelRemediation:"collect DHCP relay counters" });
  assert.equal(result.validatedEvidenceState,"SUSPECTED"); assert.equal(result.remediation.disposition,"ALLOWED_DIAGNOSTIC");
});
test("supporting and discriminating evidence derive supported then confirmed", () => {
  assert.equal(validateEvidenceState({ evidence:[{source:"router",summary:"relay packet absent"}], modelProposedState:"SUSPECTED" }).validatedEvidenceState,"SUPPORTED");
  assert.equal(validateEvidenceState({ evidence:[{source:"router",summary:"relay packet absent"},{source:"config",summary:"approved helper absent"}], modelProposedState:"SUSPECTED" }).validatedEvidenceState,"CONFIRMED");
});
test("contradiction and elimination do not confirm a hypothesis", () => {
  assert.equal(validateEvidenceState({ evidence:[{source:"probe",summary:"contradictory observations"},{source:"capture",summary:"delivery complete"}], modelProposedState:"CONFIRMED" }).validatedEvidenceState,"SUSPECTED");
  assert.equal(validateEvidenceState({ evidence:[{source:"capture",summary:"network hypothesis eliminated by clean capture"}], modelProposedState:"CONFIRMED" }).validatedEvidenceState,"ELIMINATED");
});
test("an eliminated alternative cannot suppress a supported causal hypothesis", () => {
  const result=validateEvidenceState({ evidence:[
    {source:"network",summary:"simulation",payload:{observations:{networkHypothesis:"ELIMINATED"}}},
    {source:"middleware",summary:"simulation",payload:{observations:{poolHypothesis:"SUPPORTED"}}},
    {source:"database",summary:"simulation",payload:{observations:{databaseHypothesis:"ELIMINATED"}}}
  ], modelProposedState:"SUSPECTED" });
  assert.equal(result.validatedEvidenceState,"SUPPORTED");
  assert.equal(result.overallRcaState,"SUPPORTED");
});
test("missing model escalation does not remove deterministic participant request", () => {
  const result=validateEvidenceState({ evidence:initial, modelProposedState:"ESTABLISHED", requiredParticipants:["WINDOWS","DATABASE"] });
  assert.deepEqual(result.requestedParticipants,["WINDOWS","DATABASE"]);
});
