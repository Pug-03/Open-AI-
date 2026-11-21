import { serveEvidenceMcp } from "../../../packages/walkwe-agentic/src/integrations/mcp.mjs";
import { loadWeb2Routing } from "./routing.mjs";

const { version, evidence, workflowOptions: { route } } = await loadWeb2Routing();
const trip = { from: "bts:CEN", to: "osm:W157482067" };
const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

await serveEvidenceMcp({
  datasetVersion: version, fixture: false, evidence,
  demo: mode => route({ ...trip, mode, time: mode === "night" ? "21:00" : "13:00" }),
  departures(times) {
    if (!Array.isArray(times) || times.length < 2 || times.length > 6 || !times.every(time => typeof time === "string" && clock.test(time))) {
      return { status: "invalid" };
    }
    return { status: "ok", datasetVersion: version, options: times.map(time => {
      const result = route({ ...trip, time, mode: "auto" });
      const chosen = result.routes?.find(candidate => candidate.id === result.recommendedId);
      return { time, status: result.status, mode: result.mode, minutes: chosen?.minutes ?? null, sunMinutes: chosen?.sunMinutes ?? null };
    }) };
  },
});
