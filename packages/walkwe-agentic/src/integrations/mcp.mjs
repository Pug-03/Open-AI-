import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { compareDepartureTimes, replay, segmentEvidence } from "../routing/core.mjs";
import { version } from "../routing/fixture.mjs";
import { objectSchema } from "./openai.mjs";

const annotation = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const toolDefinitions = (datasetVersion, fixture) => [
  {
    name: "get_segment_evidence", description: "Read one segment in the named Walk We dataset.",
    inputSchema: objectSchema({ segment_id: { type: "string" }, dataset_version: { const: datasetVersion } }), annotations: annotation,
  },
  {
    name: "replay_demo_trip", description: `Compute the public Siam–CentralWorld demo with ${fixture ? "fixture" : "web2 routing"} data.`,
    inputSchema: objectSchema({ mode: { enum: ["day", "night"] }, dataset_version: { const: datasetVersion } }), annotations: annotation,
  },
  {
    name: "compare_departure_times", description: "Compare two to six local Bangkok departure times for the public demo.",
    inputSchema: objectSchema({
      times: { type: "array", minItems: 2, maxItems: 6, items: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" } },
      dataset_version: { const: datasetVersion },
    }), annotations: annotation,
  },
];

const current = "2025-11-25";
const supported = new Set([current, "2025-06-18", "2025-03-26"]);
const serialize = result => ({ content: [{ type: "text", text: JSON.stringify(result) }] });
const toolError = status => ({ ...serialize({ status }), isError: true });

function callTool(params, { datasetVersion, fixture, evidence, demo, departures }) {
  const input = params?.arguments;
  if (!input || typeof input !== "object" || Object.keys(input).length !== 2 || input.dataset_version !== datasetVersion) {
    return toolError("invalid_arguments_or_dataset");
  }
  if (params.name === "get_segment_evidence" && typeof input.segment_id === "string") {
    const result = evidence(input.segment_id);
    return result ? serialize({ fixture, datasetVersion, evidence: result }) : toolError("no_data");
  }
  if (params.name === "replay_demo_trip" && ["day", "night"].includes(input.mode)) {
    return serialize({ fixture, ...demo(input.mode) });
  }
  if (params.name === "compare_departure_times") {
    const result = departures(input.times);
    return result.status === "ok" ? serialize({ fixture, ...result }) : toolError(result.status);
  }
  return toolError("unknown_tool_or_invalid_arguments");
}

export async function serveEvidenceMcp(options = {
  datasetVersion: version, fixture: true, evidence: segmentEvidence, demo: replay,
  departures: times => compareDepartureTimes({ from: "siam", to: "central" }, times),
}) {
  const tools = toolDefinitions(options.datasetVersion, options.fixture);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let initialized = false;
  const send = value => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n");
  for await (const line of lines) {
    let req;
    try { req = JSON.parse(line); } catch { send({ id: null, error: { code: -32700, message: "Parse error" } }); continue; }
    if (req?.jsonrpc !== "2.0" || typeof req.method !== "string") {
      send({ id: req?.id ?? null, error: { code: -32600, message: "Invalid Request" } });
      continue;
    }
    if (req.method === "notifications/initialized") { initialized = true; continue; }
    if (!Object.hasOwn(req, "id")) continue;
    const { id, method, params } = req;
    let result;
    switch (method) {
      case "initialize":
        result = { protocolVersion: supported.has(params?.protocolVersion) ? params.protocolVersion : current,
          serverInfo: { name: "walkwe-evidence", version: "0.1.0" }, capabilities: { tools: {} } };
        break;
      case "ping": result = {}; break;
      case "tools/list": if (initialized) result = { tools }; break;
      case "tools/call": if (initialized) result = callTool(params, options); break;
    }
    if (result) send({ id, result });
    else send({ id, error: { code: -32601, message: "Method not found or server not initialized" } });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await serveEvidenceMcp();
