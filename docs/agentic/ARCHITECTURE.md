# Walk We · Workflow architecture

The packages were imported from [Sea-x-OpenAI PR #1](https://github.com/Pug-03/Sea-x-OpenAI/pull/1). See the [latest measured OpenAI eval](../../packages/walkwe-agentic/evaluate.md).

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

Planner can call `get_trip_snapshot` to read route metrics, stress results, and deciding evidence and prepare any required clarification in one turn. The verifier checks draft claims against that snapshot and the trip constraints. Critic can read the associated evidence and return a reasoned rejection for a bounded retry. The harness fills placeholders from checked route metrics. When the model times out, exhausts its budget or returns an invalid proposal, deterministic routing and templates remain available.

## During and after the trip

| Workflow | Responsibility |
| --- | --- |
| Companion | Web2 checks the active step for closures, a transition to night, and incomplete lighting coverage. At most two notices are shown per trip. The proxy can also accept a rain event from a trusted app integration. |
| SOS | The user confirms delivery after the countdown. The authenticated outbox deduplicates the alert and distinguishes provider acceptance from recipient acknowledgement. The manual and rehearsal flows work independently. |
| Voice | The browser opens an opt-in GPT‑Live session with tools bound to the active screen from a catalog of 16. For navigation and route review, the app supplies the checked wording and figures and only plays matching OpenAI speech. ElevenLabs read-aloud and device speech remain available. |
| Steward and news | Authenticated service requests queue lighting, photo, and news drafts. An authorized reviewer can approve or reject a draft. An approval records an audit entry and a new version. |
| Research | Authorized services can start or reuse a research job for a public segment and poll the source count. Results enter `pending_review`. Connecting the browser requires an authenticated app session. |
| MCP | Read-only tools return evidence, replay and departure comparisons from the selected fixture or the versioned public Web2 graph. |

## Deployment and integration status

The web2 Agentic development host uses the same AreaRouter, public landmarks, and Siam dataset as the Vite app in `apps/web2`. It strips placeholder incidents, fingerprints the routing data, and attaches road evidence without coordinates or contact data. It evaluates app-generated routes with the Agentic decision policy. OSM lighting tags are explicit evidence, while lamp proximity remains an estimate that the Agentic host treats as unknown lighting. Route IDs reference candidate paths in the current dataset version. [Client routing Worker](../../apps/web2/src/routing/worker.ts) · [Local host](../../apps/web2/agentic/routing.mjs)

The Web2 proxy exposes `/agentic/intent`, `/agentic/plan`, and `/agentic/companion`. The planner computes routes from catalogue landmark IDs and the trusted public graph. Private pins and GPS continue to route on-device. The server may use a different route because it compares candidates with its own graph inputs. Web2 shows the server review separately and retains the user's map selection when an answer changes the lighting preference. Approved lighting is applied only to the exact edge in a matching graph version.

When a user requests a review with the on-screen control or with their voice, Web2 requests newline-delimited JSON with `Accept: application/x-ndjson`. The proxy emits milestones for route calculation, evidence collection, proposal verification and Critic review when invoked. The terminal result carries the checked recommendation and its source. Existing clients can also request a single JSON result.

The voice session stays open when the planner changes from the draft screen to route results. The user can describe a trip, confirm the two places, and say “Find routes” or “Review this route.” At night, if the recommended route has unverified lighting, Walk We asks once whether to compare with those stretches assumed lit or unlit. The answer applies to the same trip and leaves the map selection to the user. The voice reply uses the app's checked route measurements and reports whether the proposal passed verification or came from the routing engine. Public landmark trips can also be reviewed during navigation using their saved departure and endpoints. [GPT‑Live delegation](https://developers.openai.com/api/docs/guides/live-delegation)

The avatar follows the actual connection, microphone, tool, and playback states. The app mutes microphone input while handling a command and while playing the checked reply. After playback, it resumes listening in the same session. The session ends when the user stops it, leaves the voice screen, or reaches the two-minute limit.

The Worker configuration declares `EVIDENCE_QUEUE` and `SOS_OUTBOX` as SQLite-backed Durable Objects. Provider speech, the authenticated browser flows, real SOS delivery, and the exact deployed Worker version require staging verification.

## Local environment

The Node preview binds to `127.0.0.1:4178`. Run `npm run agentic:dev` for its fixture mode and `npm run test:agentic` for the Node suite. Copy [the package example](../../packages/walkwe-agentic/.env.example) to `packages/walkwe-agentic/.env` for optional provider settings, then load it with Node's `--env-file`. The local Worker reads [its own dev vars](../../packages/walkwe-agentic/.dev.vars.example). The two continuation and authorization secrets require distinct values. The env examples contain blank secret values.

From the repo root, run `npm run agentic:web2` for the canonical routing dataset. The local host accepts public place IDs such as `bts:CEN` and `osm:W157482067`. Send `POST /api/plan` with that pair in `request.from` and `request.to` and an `HH:mm` Bangkok departure in `request.time`. Run `npm run test:agentic:web2` to exercise the graph adapter and MCP without credentials. [Dot handoff](../../packages/walkwe-agentic/DOT.md)

For the hosted Worker and Web2 build, set these only in the relevant environment:

| Settings | Use |
| --- | --- |
| `VITE_AI_PROXY_URL`, `ALLOWED_ORIGINS`, `WALKWE_DATA_ORIGIN` | Pair the browser and proxy. Override the default trusted Web2 graph host for local or staging. |
| `OPENAI_API_KEY`, `OPENAI_AGENTIC_ORIGIN` | Enable paid route workflows for a controlled app origin. Both general rate limiters and `AGENTIC_MODEL_LIMITER` must permit the call. Route review and parsing can use local rules when paid calls are unavailable. |
| `VITE_VOICE_PROVIDER=openai`, `OPENAI_LIVE_ORIGIN`, `OPENAI_API_KEY` | Enable GPT‑Live on a controlled origin. For public production, use authenticated access before enabling paid sessions. [OpenAI WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live) |
| `EVIDENCE_REVIEWER_TOKENS`, `EVIDENCE_INGEST_TOKENS` | Configure separate server-only identities for ingestion and approval. See [evidence and research setup](../../packages/voice-research/README.md). |
| `VITE_SOS_PROXY_URL`, `SOS_DIRECTORY`, `SOS_TRANSPORT` | Configure the signed-in SOS relay. The directory resolves the session cookie and confirmed recipients at `/session`. The transport sends to the verified destination at `/send` and can link to `/sos/receipt?id=<alertId>`. Run a staging end-to-end test with an enrolled recipient before enabling the feature. |

### Local Worker contract

Start `POST /agent/step` with `agent`, `trip_id`, `step_index: 0`, `input` containing `text`, `lang`, `profile`, and `now`, `previous_response_id: null`, and an empty `tool_outputs` array. For a follow-up, increment the index, omit `input`, echo `response_id` as `previous_response_id`, and provide the expected `call_id` and a JSON-encoded tool envelope with `status`, `data`, `error`, and `dataset_version`.

The response ID is an expiring encrypted continuation bound to the authenticated principal, trip, role, step, and tool call. Responses requests retain `store: false` and execute one model tool call at a time. A Planner or Critic finish arrives as a tool call with `final: null`. The host verifies the proposed finish against trusted evidence and returns verifier feedback as an error envelope while steps remain. Only the host may promote a verified trip to a user-facing result. The endpoint reports usage and estimated cost where available and maps upstream rate limiting and invalid output to HTTP 429 and 422. A production adapter also needs host authorization, rate limiting, and replay idempotency.

## Context, retrieval, and caching

- **Implemented:** Intent and Planner receive a bounded, scrubbed context. The loop calls tools for routes and evidence from the same `datasetVersion`. The harness validates tool arguments, time and step budgets, and evidence IDs before exposing a verified draft. Route lookup uses typed fields such as segment, time, constraints and data provenance.
- **CAG:** the live run reported 19,233 cached input tokens through the provider. A dedicated cache-augmented generation design would preload a stable reference corpus into context and reuse it. Walk conditions and evidence versions can change per trip, so keep the trip snapshot in the tool path. [CAG paper](https://arxiv.org/abs/2412.15605)
- **MAG:** the code has separate agent roles and bounded handoffs between Planner and Critic. The encrypted continuation carries state for a single trip. A long-term user-memory or graph-based orchestration module has no defined role in the current design.
- **RAG:** an embedding index is unnecessary for finding a segment or computing a decision from the routing snapshot. If a separate reviewer feature needs to consult many unstructured reports or policy documents, evaluate document retrieval for that feature and keep publication decisions in the reviewer workflow. [RAG paper](https://arxiv.org/abs/2005.11401)
