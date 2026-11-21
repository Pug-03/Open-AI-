# Walk We · Workflow architecture

The packages were imported from [Sea-x-OpenAI PR #1](https://github.com/Pug-03/Sea-x-OpenAI/pull/1). See the [measured OpenAI live eval](EVAL_2026-11-21.md) and [screen designs](UI_DESIGN.md).

```text
packages/
  walkwe-agentic/
    src/
      agentic-workflow/   Intent, Planner, Critic, Companion and context
        harness/         Tool registry, budget, verification and replay
      routing/          Fixture graph and deterministic route metrics
      evidence/         Steward, news and human approval rules
      integrations/     Responses client, ElevenLabs tools and MCP
      workers/          Node preview and local Workers /agent/step
    evals/              Test cases, offline/mock reports and opt-in live runner
  verify/               Code checks for a draft against the route and evidence
  voice-research/        Asynchronous research and pending human review
```

## Plan a walk

The app resolves a Thai or English request to a draft and lets the user confirm the places. Routing evaluates an immutable snapshot for the chosen departure, walk constraints and opening hours. Code computes ETA, distance, shade and evidence coverage. At night the stress test varies the treatment of unknown lighting and records whether the recommendation changes. Daytime departure suggestions check the same deadline and compare walking exposure at five-minute intervals. Unknown lighting remains an explicitly missing value.

Planner asks for route metrics, stress results and evidence through tools. The verifier checks draft claims against that snapshot and the trip constraints. Critic can read the associated evidence and return a reasoned rejection for a bounded retry. The app fills the final text from checked route metrics. When the model times out, exhausts its budget or returns an invalid proposal, deterministic routing and templates remain available.

## During and after the trip

| Workflow | Responsibility |
| --- | --- |
| Companion | Reacts to a recorded trip event, opens a warning or a replan offer, and leaves route selection with the user. |
| SOS | The app opens an SOS sheet for the user. The local state machine covers hold, cancel, practice, outbox deduplication and acknowledgement with a mock transport. |
| ElevenLabs | The backend requests a signed URL and the app binds the 13 client tools to verified trip state and app callbacks. The share tool opens the app's confirmation step. |
| Steward and news | Observations and public sources enter drafts for review. Publishing and audit use the app owner's authenticated storage interface. |
| Research | The app selects a public segment, starts or reuses a research job and announces the source count after polling. Results enter `pending_review` before any potential route data update. |
| MCP | Read-only adapters expose evidence and scenario replay against the labeled fixture. |

## Deployment and integration status

The base of this repository contains the Vite app at `apps/web2`, its browser worker at `apps/web2/src/routing/worker.ts`, and a speech proxy at `apps/ai-proxy` configured as `walkwe-ai-proxy-v2`. The Agentic Worker is available for local development inside `packages/walkwe-agentic`. The app's production route snapshot, trusted trip and reviewer identities, voice SDK callbacks, and durable review and SOS transports still need adapters. [Repository base](https://github.com/Pug-03/Open-AI-/commit/ebf42d588227e0a88106d82f0e672106b41ef773)

The local web2 build reproduced `worker-BqFbNug9.js` with the same SHA-256 as the captured deployment. Its app entry `index-DKoFog3E.js` differs from the captured `index-DYn_g4TT.js`. A Cloudflare deployment record is still needed to identify the exact full app commit and running proxy version.

## Local environment

The Node preview binds to `127.0.0.1:4178`. Run `npm run agentic:dev` for its fixture mode and `npm run test:agentic` for the Node suite. Copy [the package example](../../packages/walkwe-agentic/.env.example) to `packages/walkwe-agentic/.env` for optional provider settings, then load it with Node's `--env-file`. The local Worker reads [its own dev vars](../../packages/walkwe-agentic/.dev.vars.example). The two continuation and authorization secrets require distinct values. The env examples contain blank secret values.

### Local Worker contract

Start `POST /agent/step` with `agent`, `trip_id`, `step_index: 0`, `input` containing `text`, `lang`, `profile`, and `now`, `previous_response_id: null`, and an empty `tool_outputs` array. For a follow-up, increment the index, omit `input`, echo `response_id` as `previous_response_id`, and provide the expected `call_id` and a JSON-encoded tool envelope with `status`, `data`, `error`, and `dataset_version`.

The response ID is an expiring encrypted continuation bound to the authenticated principal, trip, role, step, and tool call. Responses requests retain `store: false` and execute one model tool call at a time. The host runs and verifies tools and terminal drafts. The endpoint reports usage and estimated cost where available and maps upstream rate limiting and invalid output to HTTP 429 and 422. A production adapter also needs host authorization, rate limiting, and replay idempotency.

## Context, retrieval, and caching

- **Implemented:** Intent and Planner receive a bounded, scrubbed context. The loop calls tools for routes and evidence from the same `datasetVersion`. The harness validates tool arguments, time and step budgets, and evidence IDs before exposing a verified draft. Route lookup uses typed fields such as segment, time, constraints and data provenance.
- **CAG:** the live run reported 19,233 cached input tokens through the provider. A dedicated cache-augmented generation design would preload a stable reference corpus into context and reuse it. Walk conditions and evidence versions can change per trip, so keep the trip snapshot in the tool path. [CAG paper](https://arxiv.org/abs/2412.15605)
- **MAG:** the code has separate agent roles and bounded handoffs between Planner and Critic. The encrypted continuation carries state for a single trip. A long-term user-memory or graph-based orchestration module has no defined role in the current design.
- **RAG:** an embedding index is unnecessary for finding a segment or computing a decision from the routing snapshot. If a separate reviewer feature needs to consult many unstructured reports or policy documents, evaluate document retrieval for that feature and keep publication decisions in the reviewer workflow. [RAG paper](https://arxiv.org/abs/2005.11401)
