import { createHash } from "node:crypto";
import { activeCity } from "@walkwe/config";
import { haversineMeters, instantFromLocal, modeForTime, RoutingError } from "@walkwe/core";
import { areaDatasetSchema, incidentsDatasetSchema, withoutPlaceholders } from "@walkwe/data";
import { decideCandidates } from "../../../packages/walkwe-agentic/src/routing/core.mjs";
import { agentConfig } from "../../../packages/walkwe-agentic/src/config.mjs";
import { evidenceAge } from "../../../packages/walkwe-agentic/src/agentic-workflow/context.mjs";
import { LANDMARKS } from "../src/components/plan/landmarks.ts";
import { createPilotRouter } from "../src/routing/pilotRouter.ts";

const day = /^\d{4}-\d{2}-\d{2}$/;
const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const rejected = status => ({ status, decision: "ABSTAIN" });
const revision = value => createHash("sha256").update(value).digest("hex").slice(0, 24);

function metric(route, mode, datasetVersion) {
  const segments = route.evidence.map(segment => ({ ...segment, datasetVersion }));
  const lighting = measureLighting(segments);
  const path = segments.map(segment => segment.id).join(".");
  return {
    id: revision(path), meters: route.lengthM, minutes: Math.max(1, Math.round(route.durationS / 60)),
    shade: mode === "day" ? Math.round(route.shadeShare * 100) : null,
    sunMinutes: mode === "day" ? Math.round(route.durationS * (1 - route.shadeShare) / 6) / 10 : null,
    ...lighting, segments,
  };
}

function measureLighting(segments) {
  const distanceByLight = { lit: 0, dark: 0, unknown: 0 };
  let longestUnknown = 0;
  let unknownRun = 0;
  let covered = 0;
  for (const segment of segments) {
    distanceByLight[segment.light] += segment.length;
    covered += segment.length * segment.covered;
    unknownRun = segment.light === "unknown" ? unknownRun + segment.length : 0;
    longestUnknown = Math.max(longestUnknown, unknownRun);
  }
  return { ...distanceByLight, longestUnknown, covered };
}

export function applyApprovedLighting(result, approved, preference) {
  if (result.status !== "ok" || result.mode !== "night" || !approved.size) return result;
  const applied = new Map();
  const routes = result.routes.map(route => ({ ...route, segments: route.segments.map(segment => {
    const observation = segment.id.startsWith("edge:") && segment.light === "unknown" && approved.get(segment.id);
    if (!observation || !["lit", "dark"].includes(observation.value)
      || evidenceAge(observation.observedAt, result.date).ageStatus !== "dated") return segment;
    applied.set(segment.id, observation);
    return { ...segment, light: observation.value, observedAt: observation.observedAt,
      method: "approved_report", trust: "approved" };
  }) }));
  if (!applied.size) return result;
  const datasetVersion = `${result.datasetVersion}:${revision(JSON.stringify([...applied].sort()))}`;
  return decideCandidates(routes.map(route => ({ ...route, ...measureLighting(route.segments),
    segments: route.segments.map(segment => ({ ...segment, datasetVersion })),
  })), { mode: result.mode, date: result.date, time: result.time, preference, datasetVersion, keepAll: true });
}

const places = LANDMARKS.map(({ id, th, en, alias }) => ({
  id, name: th, en, aliases: [...(alias ?? []), ...(id === "bts:CEN" ? ["สยาม", "siam"] : [])],
}));
const locations = new Map(LANDMARKS.map(({ id, lat, lng }) => [id, { lat, lng }]));
export const publicWeb2Places = places;
export const isWeb2Place = id => locations.has(id);

export function createWeb2Routing(areaJson, incidentsJson) {
  const area = areaDatasetSchema.parse(areaJson);
  const incidents = withoutPlaceholders(incidentsDatasetSchema.parse(incidentsJson));
  const router = createPilotRouter(area, incidents);
  const version = `web2:${revision(JSON.stringify([area, incidents]))}`;
  const referenceDate = area.updatedAt.slice(0, 10);

  function route(request) {
    const from = locations.get(request?.from);
    const to = locations.get(request?.to);
    if (!from || !to || haversineMeters(from, to) > activeCity.maxWalkM) return rejected("out_of_coverage");
    const { time, date = referenceDate, preference, arriveBy, maxMinutes } = request;
    const parsedDay = typeof date === "string" && day.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
    if (request.from === request.to || typeof time !== "string" || !clock.test(time)
      || !Number.isFinite(parsedDay) || new Date(parsedDay).toISOString().slice(0, 10) !== date
      || (arriveBy != null && (typeof arriveBy !== "string" || !clock.test(arriveBy)))
      || (maxMinutes != null && (!Number.isFinite(maxMinutes) || maxMinutes <= 0))) return rejected("invalid");
    const departAt = instantFromLocal(`${date}T${time}`, activeCity.timezone);
    const mode = ["day", "night"].includes(request.mode) ? request.mode : modeForTime(departAt, from);
    try {
      const result = router.routeSync({ from, to, departAt, mode, stepFree: request.noStairs === true }, true);
      const candidates = result.routes.filter(route => route.lengthM > 0 && route.lengthM <= activeCity.maxWalkM
        && (!request.noStairs || route.evidence.every(segment => segment.stairs === false))
        && (maxMinutes == null || route.durationS / 60 <= maxMinutes)
        && (arriveBy == null || minutes(time) + route.durationS / 60 <= minutes(arriveBy)));
      return decideCandidates(candidates.map(route => metric(route, mode, version)),
        { mode, time, date, preference, datasetVersion: version, keepAll: true });
    } catch (error) {
      if (!(error instanceof RoutingError)) throw error;
      return rejected(error.reason === "no-path" ? "no_path" : "out_of_coverage");
    }
  }

  function departure(request, routeId, maxDelay) {
    const initial = route(request);
    if (initial.status !== "ok" || initial.mode !== "day") return null;
    const original = initial.routes.find(candidate => candidate.id === routeId);
    if (!original) return null;
    let best;
    for (let delay = agentConfig.departureShiftStepMinutes; delay <= maxDelay; delay += agentConfig.departureShiftStepMinutes) {
      const target = minutes(initial.time) + delay;
      if (target >= 1440) break;
      const time = [Math.floor(target / 60), target % 60].map(value => String(value).padStart(2, "0")).join(":");
      const result = route({ ...request, time, mode: "auto" });
      const candidate = result.mode === "day" && result.routes?.find(option => option.id === routeId);
      if (candidate && candidate.sunMinutes < (best?.sun_minutes ?? original.sunMinutes)) {
        best = { depart_at: `${initial.date}T${time}:00+07:00`, delay_min: delay,
          sun_minutes: candidate.sunMinutes, original_sun_minutes: original.sunMinutes };
      }
    }
    return best ?? null;
  }

  const segmentKnown = id => typeof id === "string" && /^edge:(?:0|[1-9]\d{0,8})$/.test(id)
    && Number(id.slice(5)) < router.area.edgeCount;
  const evidence = id => segmentKnown(id) ? router.segmentEvidence(Number(id.slice(5))) : null;
  return { version, referenceDate, segmentKnown, evidence,
    segmentName: id => evidence(id)?.name || null, workflowOptions: { route, places, departure } };
}
