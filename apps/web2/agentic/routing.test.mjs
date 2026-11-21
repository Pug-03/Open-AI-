import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createWorkflows } from "../../../packages/walkwe-agentic/src/agentic-workflow/agents.mjs";
import { applyApprovedLighting } from "./routing-core.mjs";
import { loadWeb2Routing } from "./routing.mjs";

const { version, evidence, referenceDate, workflowOptions } = await loadWeb2Routing();
const request = { from: "bts:CEN", to: "osm:W157482067", time: "21:00", mode: "night", date: referenceDate };

test("real web2 landmarks lead to the same public graph used by the app Worker", async () => {
  const workflows = createWorkflows(workflowOptions);
  const intent = await workflows.intent({ text: "สามทุ่มจากสยามไปเซ็นทรัลเวิลด์" });
  assert.deepEqual(intent.draft, { from: request.from, to: request.to, time: request.time, mode: request.mode, noStairs: false });
  const result = await workflows.plan({ ...intent.draft, date: referenceDate }, { expectedDatasetVersion: version });
  assert.equal(result.status, "ok");
  assert.match(result.datasetVersion, /^web2:/);
  assert.equal(result.source, "worker");
  const route = result.routes.find(candidate => candidate.id === result.recommendedId);
  assert.ok(route.segments.some(segment => segment.light === "unknown"));
  assert.ok(route.segments.every(segment => segment.method !== "lamp_proximity" || segment.light === "unknown"));
  const segment = route.segments.find(item => item.id.startsWith("edge:"));
  assert.deepEqual({ ...evidence(segment.id), datasetVersion: version }, segment);
  assert.ok(route.minutes > 0);
  assert.equal(route.sunMinutes, null);
  assert.equal(Object.hasOwn(segment, "coordinates"), false);
  assert.equal((await workflows.plan(request, { expectedDatasetVersion: "siam-sandbox-1" })).status, "stale_snapshot");
  assert.equal(workflowOptions.route({ ...request, date: "2026-99-99" }).status, "invalid");
  assert.equal(workflowOptions.route({ ...request, arriveBy: "21:01" }).status, "no_path");
  const daylight = workflowOptions.route({ ...request, time: "13:00", mode: "day" });
  assert.ok(daylight.routes.some(candidate => candidate.segments.some(segment => typeof segment.shaded === "number")));
});

test("only fresh approved public-edge lighting changes the versioned routing snapshot", () => {
  const base = workflowOptions.route(request);
  const unknown = base.routes.flatMap(route => route.segments)
    .find(segment => segment.id.startsWith("edge:") && segment.light === "unknown");
  const overlay = new Map([[unknown.id, { value: "lit", observedAt: referenceDate }]]);
  const result = applyApprovedLighting(base, overlay);
  assert.notEqual(result.datasetVersion, version);
  const updated = result.routes.flatMap(route => route.segments).filter(segment => segment.id === unknown.id);
  assert.ok(updated.length > 0);
  assert.ok(updated.every(segment => segment.light === "lit" && segment.trust === "approved"
    && segment.datasetVersion === result.datasetVersion));
  assert.equal(applyApprovedLighting(base, new Map([[unknown.id, { value: "lit", observedAt: "2000-01-01" }]])), base);
  assert.equal(applyApprovedLighting(base, new Map([[unknown.id, { value: "dim", observedAt: referenceDate }]])), base);
});

test("MCP advertises the real dataset and all three read-only tools work over stdio", () => {
  const current = workflowOptions.route(request);
  const segmentId = current.routes.flatMap(route => route.segments).find(segment => segment.id.startsWith("edge:")).id;
  const invoke = (id, name, args, datasetVersion = version) => ({
    jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: { ...args, dataset_version: datasetVersion } },
  });
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    invoke(3, "get_segment_evidence", { segment_id: segmentId }),
    invoke(4, "replay_demo_trip", { mode: "night" }),
    invoke(5, "compare_departure_times", { times: ["13:00", "21:00"] }),
    invoke(6, "get_segment_evidence", { segment_id: segmentId }, "siam-sandbox-1"),
  ];
  const processResult = spawnSync(process.execPath, ["--import", "tsx", "apps/web2/agentic/mcp.mjs"], {
    input: messages.map(row => JSON.stringify(row)).join("\n") + "\n", encoding: "utf8", timeout: 15_000,
  });
  assert.equal(processResult.status, 0, processResult.stderr);
  const responses = new Map(processResult.stdout.trim().split("\n").map(line => {
    const row = JSON.parse(line);
    return [row.id, row.result];
  }));
  assert.equal(responses.get(1).protocolVersion, "2025-11-25");
  assert.deepEqual(responses.get(2).tools.map(tool => tool.name),
    ["get_segment_evidence", "replay_demo_trip", "compare_departure_times"]);
  assert.ok(responses.get(2).tools.every(tool => tool.annotations.readOnlyHint));
  const toolResult = id => JSON.parse(responses.get(id).content[0].text);
  assert.equal(toolResult(3).fixture, false);
  assert.equal(toolResult(3).evidence.id, segmentId);
  assert.equal(toolResult(4).datasetVersion, version);
  assert.deepEqual(toolResult(5).options.map(option => option.mode), ["day", "night"]);
  assert.equal(responses.get(6).isError, true);
});
