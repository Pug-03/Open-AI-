import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { compareDepartureTimes } from "../routing/core.mjs";
import { edges, referenceDate, version } from "../routing/fixture.mjs";
import { draftLightingProposal, draftNews, stewardReview } from "../evidence/review.mjs";
import { createModelClient, modelProfiles } from "../integrations/openai.mjs";
import { getSignedVoiceUrl } from "../integrations/voice.mjs";
import { askTrip, createWorkflows } from "../agentic-workflow/agents.mjs";

const segmentIds = edges.map(edge => edge.id);
const localHost = /^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

export function createPreviewServer({ model = null, voice, workflowOptions = {}, dataset } = {}) {
  const workflows = createWorkflows({ ...workflowOptions, model });
  const segmentKnown = dataset?.segmentKnown ?? (id => segmentIds.includes(id));
  const trustedPlan = data => workflows.plan(data.request, { expectedDatasetVersion: data.expectedDatasetVersion });
  const actions = {
    "/api/intent": data => workflows.intent(data),
    "/api/plan": data => workflows.plan(data.request, {
      useModel: data.useModel === true,
      expectedDatasetVersion: typeof data.expectedDatasetVersion === "string" ? data.expectedDatasetVersion : undefined,
    }),
    "/api/departure": data => dataset
      ? { status: "ok", suggestion: workflowOptions.departure(data.request, data.routeId, 30) }
      : compareDepartureTimes(data.request, data.times),
    "/api/ask": async data => askTrip(data.question, await trustedPlan(data)),
    "/api/companion": async data => {
      if (!dataset) return workflows.companion(data);
      const result = await trustedPlan(data);
      const route = result.routes.find(item => item.id === (data.routeId ?? result.recommendedId));
      return workflows.companion({ ...data, route });
    },
    "/api/steward": async data => {
      if (dataset && data.datasetVersion !== dataset.version) return { status: "stale_snapshot" };
      if (!segmentKnown(data.segmentId) || !Array.isArray(data.observations) || data.observations.length > 100) return { status: "invalid" };
      const proposal = draftLightingProposal(data);
      return stewardReview({ proposal, model: data.useModel === true ? model : null });
    },
    "/api/news": data => {
      if (dataset && data.datasetVersion !== dataset.version) return { status: "stale_snapshot" };
      const allowedSegmentIds = dataset
        ? (Array.isArray(data.segmentIds) ? [...new Set(data.segmentIds.slice(0, 40))].filter(segmentKnown) : [])
        : segmentIds;
      return draftNews({ ...data, allowedSegmentIds }, data.useModel === true ? model : null);
    },
    "/api/voice/session": data => data.consent === true && voice
      ? getSignedVoiceUrl(voice)
      : { status: "unavailable" },
  };

  return createServer(async (req, res) => {
    const respond = (code, data) => {
      res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
        "x-content-type-options": "nosniff" });
      res.end(JSON.stringify(data));
    };
    try {
      const host = req.headers.host ?? "";
      if (!localHost.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
        return respond(403, { status: "forbidden" });
      }
      const pathname = new URL(req.url, `http://${host}`).pathname;
      if (pathname === "/api/status" && req.method === "GET") return respond(200, {
        status: "ok", mode: dataset ? "web2" : "fixture", version: dataset?.version ?? version,
        referenceDate: dataset?.referenceDate ?? referenceDate, modelConfigured: Boolean(model),
        voiceConfigured: Boolean(voice?.apiKey && voice?.agentId), modelProfiles,
      });
      if (req.method !== "POST" || !Object.hasOwn(actions, pathname)) return respond(404, { status: "not_found" });
      if (req.headers["content-type"]?.split(";")[0] !== "application/json") return respond(415, { status: "expected_json" });
      let text = "";
      for await (const chunk of req.setEncoding("utf8")) {
        text += chunk;
        if (Buffer.byteLength(text) > 20000) return respond(413, { status: "payload_too_large" });
      }
      let data;
      try { data = JSON.parse(text); } catch { return respond(400, { status: "invalid_json" }); }
      if (!data || Array.isArray(data) || typeof data !== "object") return respond(400, { status: "invalid_json" });
      const action = await actions[pathname](data);
      return respond(action.status === "invalid" ? 422 : 200, action);
    } catch {
      return respond(500, { status: "internal_error" });
    }
  });
}

export function startPreview({ workflowOptions, dataset } = {}) {
  const port = Number(process.env.WALKWE_PORT ?? 4178);
  const model = createModelClient({ apiKey: process.env.WALKWE_OPENAI_API_KEY });
  const voice = { apiKey: process.env.WALKWE_ELEVENLABS_API_KEY, agentId: process.env.WALKWE_ELEVENLABS_AGENT_ID };
  return createPreviewServer({ model, voice, workflowOptions, dataset }).listen(port, "127.0.0.1", () => {
    process.stderr.write(`Walk We ${dataset ? "web2" : "fixture"} API on http://127.0.0.1:${port}\n`);
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) startPreview();
