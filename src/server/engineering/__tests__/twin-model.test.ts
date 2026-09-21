import test from "node:test";
import assert from "node:assert/strict";
import { TwinModelClient, finalModelAnswer } from "../../twin-model.ts";

test("usage includes rejected primary output and successful fallback without inventing missing tokens", async () => {
  const runs: import("../../twin-model.ts").TwinModelRun[] = [];
  let attempts = 0;
  const client = new TwinModelClient({ OLLAMA_BASE_URL: "http://model" }, (async () => {
    attempts++;
    return new Response(JSON.stringify(attempts === 1
      ? { prompt_eval_count: 120, eval_count: 384, done_reason: "length", message: { content: "partial" } }
      : { prompt_eval_count: 125, eval_count: 30, message: { content: JSON.stringify({ answer: "Inspect the service logs." }) } }));
  }) as typeof fetch);
  await client.generate([], "CONVERSATION", run => runs.push(run));
  assert.deepEqual(runs.map(run => [run.status, run.inputTokens, run.outputTokens]), [["FAILED", 120, 384], ["SUCCEEDED", 125, 30]]);
  assert.ok(runs.every(run => typeof run.durationMs === "number" && run.durationMs >= 0));
  const unavailable: typeof runs = [];
  const failing = new TwinModelClient({ OLLAMA_BASE_URL: "http://model" }, (async () => new Response("Unavailable", { status: 503 })) as typeof fetch);
  await assert.rejects(failing.generate([], "CONVERSATION", run => unavailable.push(run)));
  assert.ok(unavailable.every(run => run.inputTokens === null && run.outputTokens === null));
});

test("only a complete final answer reaches the twin", () => {
  assert.equal(finalModelAnswer({ message: { thinking: "private trace", content: "Final answer" } }), "Final answer");
  assert.equal(finalModelAnswer({ message: { content: "<think>private trace</think>Final answer" } }), "Final answer");
  assert.throws(() => finalModelAnswer({ message: { content: "<think>unfinished" } }));
  assert.throws(() => finalModelAnswer({ done_reason: "length", message: { content: "partial answer" } }));
  assert.throws(() => finalModelAnswer({ message: { thinking: "no final output" } }));
});

test("distilled model uses structured A2A output and explicit fallback on invalid output", async () => {
  const requests: any[] = [];
  const client = new TwinModelClient({ OLLAMA_BASE_URL: "http://model" }, (async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    return new Response(JSON.stringify({ message: { content: requests.length === 1 ? "not JSON" : JSON.stringify({ assessment: "Needs evidence", nextCheck: "Read event logs", evidenceIds: [] }) } }), { status: 200 });
  }) as typeof fetch);
  await client.generate([{ role: "user", content: "Validate maintenance" }], "COLLABORATION");
  assert.equal(requests[0].model, "cloudzero-qwen3:4b-q4_K_M");
  assert.match(requests[0].messages[0].content, /\/no_think$/);
  assert.equal(requests[0].think, false);
  assert.equal(requests[0].format.type, "object");
  assert.equal(requests[1].model, "qwen2.5:3b");
});

test("model failures remain failures instead of fabricated successful answers", async () => {
  let calls = 0;
  const client = new TwinModelClient({ OLLAMA_BASE_URL: "http://model" }, (async () => { calls++; return new Response("Unavailable", { status: 503 }); }) as typeof fetch);
  await assert.rejects(client.generate([], "CONVERSATION"), /could not produce/);
  assert.equal(calls, 2);
});

test("missing configuration makes no network request", async () => {
  const client = new TwinModelClient({}, (async () => { assert.fail("must not connect"); }) as typeof fetch);
  await assert.rejects(client.generate([], "CONVERSATION"), /not configured/);
  assert.equal((await client.status()).reachable, false);
});

test("status reports actual GGUF quantization and digest from Ollama", async () => {
  const client = new TwinModelClient({ OLLAMA_BASE_URL: "http://model" }, (async url => new Response(JSON.stringify(String(url).endsWith("/api/tags")
    ? { models: [{ name: "cloudzero-qwen3:4b-q4_K_M", digest: "sha256:model" }] }
    : { details: { format: "gguf", family: "qwen3", parameter_size: "4.0B", quantization_level: "Q4_K_M" } }), { status: 200 })) as typeof fetch);
  const status = await client.status();
  assert.equal(status.primaryInstalled, true);
  assert.equal(status.primaryDetails?.format, "gguf");
  assert.equal(status.primaryDetails?.quantizationLevel, "Q4_K_M");
  assert.equal(status.primaryDigest, "sha256:model");
});

test("status never infers quantization from the alias when inspection fails", async () => {
  const client = new TwinModelClient({ OLLAMA_BASE_URL: "http://model" }, (async () => new Response("Unavailable", { status: 503 })) as typeof fetch);
  assert.equal((await client.status()).primaryDetails, null);
});

test("conversation JSON is unwrapped before speaking and uses the same model client", async () => {
  const client = new TwinModelClient({ OLLAMA_BASE_URL: "http://model" }, (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.format.required, ["answer"]);
    return new Response(JSON.stringify({ message: { thinking: "not spoken", content: JSON.stringify({ answer: "Check the service's event log first." }) } }), { status: 200 });
  }) as typeof fetch);
  assert.equal(await client.generate([{ role: "user", content: "Help with Windows" }], "CONVERSATION"), "Check the service's event log first.");
});
