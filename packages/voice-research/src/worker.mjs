const route = "/agents/research";
const segmentPattern = /^[a-z0-9][a-z0-9_.:-]{0,95}$/i;
const versionPattern = /^[a-z0-9][a-z0-9_.:-]{0,95}$/i;
const jobPath = /^\/agents\/research\/([a-f0-9-]{36})$/;

function json(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function jobResponse(job, cached) {
  if (!job) return json(404, { status: "not_found" });
  const { id, status, sourceCount, completedAt } = job;
  return json(["starting", "researching"].includes(status) ? 202 : 200,
    { id, status, cached, sourceCount, completedAt });
}

async function readSegment(request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 256) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    const body = JSON.parse(text + decoder.decode());
    if (!body || !Object.keys(body).every(key => key === "segmentId" || key === "datasetVersion")
      || typeof body.segmentId !== "string" || !segmentPattern.test(body.segmentId)
      || (Object.hasOwn(body, "datasetVersion") && (typeof body.datasetVersion !== "string" || !versionPattern.test(body.datasetVersion)))) return null;
    return body;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export function createResearchRoutes({ authenticate, resolvePublicSegment, store, agents }) {
  async function start(id, publicName) {
    try {
      await store.start(id, await agents.start(publicName));
    } catch {
      await store.finish(id, null);
    }
  }

  return async function researchRoute(request, ctx) {
    const path = new URL(request.url).pathname;
    const jobMatch = jobPath.exec(path);
    if (path !== route && !jobMatch) return null;
    const method = jobMatch ? "GET" : "POST";
    if (request.method !== method) return json(405, { status: "method_not_allowed" });

    try {
      const owner = await authenticate(request);
      if (!owner) return json(401, { status: "unauthorized" });
      if (jobMatch) {
        const job = await store.get(owner, jobMatch[1]);
        if (job?.status !== "researching") return jobResponse(job);
        const outcome = await agents.poll(job.providerId);
        if (outcome.status === "researching") return jobResponse(job);
        return jobResponse(await store.finish(job.id, outcome.status === "complete" ? outcome.sources : null));
      }

      const input = await readSegment(request);
      if (!input) return json(422, { status: "invalid_segment" });
      const { segmentId } = input;
      const segment = await resolvePublicSegment(owner, segmentId, input.datasetVersion);
      const publicName = typeof segment === "string" ? segment : segment?.name;
      if (typeof publicName !== "string" || !publicName.trim() || publicName.length > 160) {
        return json(404, { status: "unknown_segment" });
      }

      const { job, created, cached } = await store.claim({
        owner, segmentId, publicName: publicName.trim(), datasetVersion: segment?.datasetVersion,
      });
      if (created) ctx.waitUntil(start(job.id, publicName.trim()));
      return jobResponse(job, cached);
    } catch {
      return json(503, { status: "unavailable" });
    }
  };
}
