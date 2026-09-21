import path from "node:path";
import { DocumentKnowledgeStore } from "../src/server/knowledge-index.ts";

async function main() {
  const question = process.argv[2]?.trim();
  const indexRoot = path.resolve(process.argv[3] || path.join(".data", "knowledge"));
  if (!question) throw new Error("Usage: npm run knowledge:query -- \"question\" [index-root]");
  const store = new DocumentKnowledgeStore();
  const status = await store.load(indexRoot);
  if (!status.chunkCount) throw new Error(`No validated knowledge chunks were found in ${indexRoot}.`);
  console.log(JSON.stringify({ ...store.answer(question), index: status }, null, 2));
}

main().catch(error => {
  console.error(`Knowledge query failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

