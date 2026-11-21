# OpenAI live eval rerun

The 12 cases ran against [source commit 2f47454](https://github.com/Pug-03/Open-AI-/commit/2f47454e47f97f3dd0652315fd7dc3536de364e0) using the `siam-sandbox-1` scenario dataset and `walkwe-context-v3`. This commit contains the Planner and Intent changes and precedes the web2 routing integration commits. [Historical run](EVAL_2026-11-21.md)

Run completed 2026-11-21 14:51 ICT. **10/12 passed** across 10 Intent cases and 2 trip planner cases.

- End-to-end case latency p50 **1,691 ms**, p95 **20,003 ms**.
- Intent passed **10/10** (p50 1,630 ms, p95 4,480 ms). Planner passed **0/2**. Critic received calls in **0/2** cases and accepted **0/2**.
- OpenAI request outcomes by HTTP status: 200 × 14, no HTTP response × 2.
- Usage returned for **14/16** requests. Totals **11,482 input**, **2,768 output**, **1,405 reasoning** (included in output), **5,148 cached input**, and **2,727 cache-write tokens**. Cost for reported usage: **$0.021113 estimated**.

| Case | Result | API calls | Planner/Critic calls | Critic | Input | Cached input | Cache write | Output | Reasoning | Latency | Est. USD |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `L-I01` | Pass | 1 | 0/0 | — | 331 | 0 | 0 | 33 | 0 | 4,480 ms | $0.000496 |
| `L-I02` | Pass | 1 | 0/0 | — | 321 | 0 | 0 | 34 | 0 | 1,820 ms | $0.000491 |
| `L-I03` | Pass | 1 | 0/0 | — | 299 | 0 | 0 | 31 | 0 | 1,630 ms | $0.000454 |
| `L-I04` | Pass | 1 | 0/0 | — | 300 | 0 | 0 | 30 | 0 | 1,612 ms | $0.000450 |
| `L-I05` | Pass | 1 | 0/0 | — | 310 | 0 | 0 | 31 | 0 | 1,691 ms | $0.000465 |
| `L-I07` | Pass | 1 | 0/0 | — | 311 | 0 | 0 | 33 | 0 | 1,973 ms | $0.000476 |
| `L-I10` | Pass | 1 | 0/0 | — | 304 | 0 | 0 | 30 | 0 | 1,319 ms | $0.000454 |
| `L-I11` | Pass | 1 | 0/0 | — | 301 | 0 | 0 | 30 | 0 | 1,610 ms | $0.000451 |
| `L-I15` | Pass | 1 | 0/0 | — | 319 | 0 | 0 | 35 | 0 | 2,008 ms | $0.000494 |
| `L-I17` | Pass | 1 | 0/0 | — | 307 | 0 | 0 | 32 | 0 | 1,534 ms | $0.000467 |
| `L-night` | Fail (deadline) | 3 | 3/0 | not reached | 4,258 | 1,749 | 2,257 | 1,192 | 716 | 20,003 ms | $0.009121 |
| `L-day` | Fail (deadline) | 3 | 3/0 | not reached | 4,121 | 3,399 | 470 | 1,257 | 689 | 20,002 ms | $0.007294 |

Cost uses the branch's Standard price table and provider-returned usage. A dash means the provider returned no usable value.

## Planner trajectory

| Case | First action | First draft | Revision | Critic |
| --- | --- | --- | --- | --- |
| Night | Snapshot returned the routes, stress test, lighting evidence, and clarification | V3 and V5 failed after a 14.293 s model call | Aborted at the 20 s case deadline | No API call |
| Day | Snapshot returned the routes and stress test | V5 failed after a 15.041 s model call | Aborted at the 20 s case deadline | No API call |

V3 checks disclosure of unknown evidence. V5 checks whether claims and placeholders cite matching evidence. Both cases retained the deterministic routing fallback.

Compared with the baseline, Intent improved from 7/10 to 10/10 and each Planner case used three calls instead of six. Total input dropped from 26,432 to 11,482 tokens, while output rose from 1,118 to 2,768. The estimated cost for reported usage rose from USD 0.014646 to USD 0.021113. Two aborted requests lacked usage in each run.
