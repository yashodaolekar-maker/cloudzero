# Engineering twin conversational curriculum

The voice copilot uses five role profiles in `src/server/engineer-conversation.ts`. Auto mode selects from the current question, then recent user context; the role selector overrides auto selection. The most recent eight supplied turns are bounded and passed to the local Ollama model. Conversation is scoped to the browser's existing voice history, not durable personal memory.

Each profile covers daily review, incident scoping, diagnostic isolation, change preparation, rollback, validation and handover. Network covers packet paths and perimeter controls; Windows covers identity and server operations; CloudOps covers accounts, regions, resources and cost; DevOps covers builds, releases and runtime health; Linux covers services and host resource diagnosis.

This is inference-time role instruction and retrieval, not model-weight training. General model advice is PARTIAL, never certified as observed environment state. Direct curated answers retain knowledge citations. Incident claims retain the deterministic evidence path. Execution requests remain on the existing approval workflow. A model timeout returns role-specific read-only guidance. The existing quantum-inspired incident hypothesis engine is unchanged: it scores diagnostic evidence, not emotion.

To extend the curriculum, add reviewed role guidance and ingest organization runbooks through the existing knowledge ingestion workflow. Include expected behavior, prerequisite checks, failure modes, escalation owners, rollback criteria and post-change validation. Never ingest credentials. Evaluate new examples before deployment with `npx tsx --test src/server/engineering/__tests__/engineer-conversation.test.ts` and the grounding suite.

Evaluation should cover every role's routine work, follow-ups and corrections, frustrated users, ambiguous failures, missing evidence, action requests, model unavailability and mixed-domain problems. Responses should distinguish reports from observations, avoid invented execution, and ask a focused diagnostic question. This first implementation does not guarantee human equivalence or factual correctness of generated guidance.
