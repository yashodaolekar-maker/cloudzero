import { TwinModelClient } from "../src/server/twin-model.ts";
import { respondAsEngineer } from "../src/server/engineer-conversation.ts";

const model = process.env.OLLAMA_MODEL || "cloudzero-qwen3:4b-q4_K_M";
const client = new TwinModelClient({ ...process.env, OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  OLLAMA_MODEL: model, OLLAMA_FALLBACK_MODEL: model });
const cases = [
  { role: "NETWORK", question: "In two sentences, describe how a network engineer distinguishes a firewall policy problem from a routing problem." },
  { role: "WINDOWS", question: "In two sentences, what should a Windows administrator check when domain logons fail after maintenance?" },
  { role: "CLOUDOPS", question: "In two sentences, how would a CloudOps engineer investigate an unexpected cloud cost increase?" },
  { role: "DEVOPS", question: "In two sentences, what should a DevOps engineer compare when a deployment fails but the previous release worked?" },
  { role: "LINUX", question: "In two sentences, explain the difference between a Linux process and a service." }
];
let failures = 0;
for (const item of cases) {
  const started = Date.now();
  const answer = await respondAsEngineer(item, messages => client.generate(messages, "CONVERSATION"));
  const passed = answer.responseMode === "GENERAL_GUIDANCE" && !/<think>/i.test(answer.text);
  if (!passed) failures++;
  console.log(JSON.stringify({ ...item, passed, elapsedMs: Date.now() - started, answer: answer.text }));
}
try {
  const text = await client.generate([{ role: "user", content: 'Network asks Windows to validate a reported outage after maintenance. No diagnostics have been collected. Return JSON with assessment, nextCheck and evidenceIds. Do not assert causation or executed work. evidenceIds must be empty. Give one read-only validation step.' }], "COLLABORATION");
  const answer = JSON.parse(text);
  const passed = answer.evidenceIds.length === 0;
  if (!passed) failures++;
  console.log(JSON.stringify({ role: "A2A", passed, answer }));
} catch { failures++; console.log(JSON.stringify({ role: "A2A", passed: false })); }
console.log(JSON.stringify({ model, failures, note: "Smoke checks test complete outputs, not expert-level factual accuracy; review answers manually." }));
process.exitCode = failures ? 1 : 0;
