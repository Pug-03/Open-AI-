# Walk We · Agentic evaluation

## Results

| Lane | Result | What it establishes |
| --- | --- | --- |
| Node tests across both packages | 41/41 | Routing, tool order and retry, deterministic checks, Worker continuation and authorization, voice bindings, SOS practice and research queue |
| Fixture eval | 34/34 | Parsing, route metrics, evidence snapshots, and safeguards with the Siam scenario graph |
| Mock Responses eval | 18/18 | Structured outputs, tool replay, fallback and 14 regression traps |
| Live OpenAI on the Web2 integration checkout | 12/12 | Intent 10/10 and Planner 2/2. Critic accepted both verified trip proposals. |

The saved [offline report](evals/eval_report.json) uses fixture dataset version `siam-sandbox-1`. See the [historical live run](../../docs/agentic/EVAL_2026-11-21.md) and the [12-case live rerun with per-case usage, latency, cost, and Critic trace](../../docs/agentic/EVAL_2026-11-21_RERUN.md).

### Integration live run, 21 November 2026

OpenAI executed all 12 cases in `siam-sandbox-1` with `walkwe-context-v3`. GPT‑6.1 Terra ran Intent and Planner. GPT‑6.1 Sol accepted the two Planner drafts after the verifier passed.

| Cases | Passed | p50 | p95 |
| --- | ---: | ---: | ---: |
| All live cases | 12/12 | 1,662 ms | 8,916 ms |
| Intent | 10/10 | 1,603 ms | 3,915 ms |
| Planner and Critic | 2/2 | 7,661 ms | 8,916 ms |

- `L-day` completed with a verified result in 7,661 ms.
- `L-night` produced a verified clarification in 8,916 ms. It preserved unknown lighting and reached the expected `needs_user` state.
- All 16 requests reported usage. They used 9,763 input and 893 output tokens, including 276 reasoning tokens. Estimated total cost was **$0.016954**.

The hosted routing integration tests exercise the public Siam graph with mocked model calls. The 12 live cases above use scenario fixtures, so staging still needs a live trip against the deployed graph and voice service.

## Run the checks

From the repository root:

```sh
npm run test:agentic
npm run eval:agentic -- --out packages/walkwe-agentic/evals/eval_report.json
```

To opt in to live evaluation, copy [.env.example](.env.example) to `.env` in this package and set `WALKWE_OPENAI_EVAL_API_KEY`:

```sh
node --env-file=packages/walkwe-agentic/.env packages/walkwe-agentic/evals/run.mjs --live --out live-report.json
```

Add `--case <id>` to limit the provider calls. Live cases report results and latency per case, including failed requests and their HTTP statuses. Usage lists input, cached input, cache write, output and reasoning tokens. The estimate uses the same standard pricing table as the Worker. Reasoning contributes to output tokens. A response without usage carries no cost estimate.

## Core expectations

- Intent treats the user request as data, supports Thai and English, and falls back to the confirmable local draft on conflicting place IDs.
- A night flip requires the planner to call routing and stress tools, read the deciding evidence, and request clarification under the configured question budget. Numbers come from the checked Worker snapshot.
- The verifier checks V1–V8 and tool errors against fixture evidence. Critic reads the cited segment, returns a structured verdict, and can trigger a bounded rewrite. Stair status must be explicitly clear for a step-free route.
- Duplicate calls, unsupported outputs, provider errors and time limits keep the deterministic route response available. The mock lane exercises these outcomes without credentials.

Model settings are in [the Responses client](src/integrations/openai.mjs). Routing evidence and weather availability are limited by the connected adapter. The local suites do not establish production route quality or live model behavior.
