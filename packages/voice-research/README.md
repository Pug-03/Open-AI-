# Walk We voice research

`research_segment` uses the segment selected in the app. The night route evidence panel acknowledges the job, polls the proxy, and shows the source count when a draft is ready.

The Web2 proxy mounts two research routes. `POST /agents/research` accepts `segmentId` and the exact `datasetVersion` of the public routing graph. `GET /agents/research/:id` exposes status and the source count to the identity that claimed the job. The Worker resolves the edge against the graph and sends only the public street name and city to OpenAI. Edges without a public street name or from a different graph version are rejected.

`src/store.mjs` implements job claims and a cache by graph version, segment and street name. It reuses a completed result for 24 hours and expires pending jobs after five minutes. The hosted adapter adds the `pending_review` draft to the evidence queue in the same storage transaction as the job result. The status request collects research results, so the client must poll before a pending job expires.

## Evidence review service

Set `EVIDENCE_INGEST_TOKENS` and `EVIDENCE_REVIEWER_TOKENS` as Worker secrets. Each is a JSON object mapping identities to unique, randomly generated base64url tokens of at least 32 characters. Clients call the service with the identity's bearer token. Keep these tokens in an authenticated backend or use them from a trusted operator client. Web2 research is enabled on `OPENAI_AGENTIC_ORIGIN` with an OpenAI key and rate limits. The browser uses an in-memory capability for research starts and polls. Evidence submission and review still require service identities.

| Endpoint | Access and behavior |
| --- | --- |
| `POST /evidence/lighting` | Ingest identity submits `segmentId`, `datasetVersion`, `timeBand` and `value`. A draft requires corroboration from distinct authenticated reporters. |
| `POST /evidence/news` | Ingest identity submits `datasetVersion`, `text`, `sourceUrl` and `allowedSegmentIds`. The Worker extracts from the submitted public excerpt without fetching its URL. |
| `POST /evidence/photo` | A trusted ingest service submits `segmentId`, `datasetVersion`, `consentGranted` and `trustedImage` after re-encoding the image and removing metadata and identifying details. |
| `GET /evidence/pending` | Reviewer lists drafts. Use the returned `next` as the `after` query parameter to continue. |
| `POST /evidence/decision` | Reviewer sends `proposalId`, `expectedVersion` from the draft's `revision`, and `decision` of `approve` or `reject`. A stale draft returns 409. |
| `GET /evidence/approved`, `GET /evidence/audit` | Reviewers read approved drafts and the audit trail. Ingest identities can read approved drafts only. |

An approved round of night lighting observations can fill an unknown edge in the Planner's matching graph snapshot. News, photo labels and web research remain attributed review records. Set `OPENAI_API_KEY` for the research provider and model-backed drafts. The workflow and mock provider can be tested without credentials.

```sh
node --test packages/voice-research/tests/research.test.mjs
```
