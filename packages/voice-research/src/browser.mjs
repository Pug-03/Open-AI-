const route = "/agents/research";
const waiting = status => status === "starting" || status === "researching";
const messages = {
  th: {
    failure: "ค้นข้อมูลเพิ่มเติมไม่สำเร็จ", noSources: "ยังไม่พบแหล่งข้อมูลเพิ่มเติม",
    noSegment: "เลือกช่วงทางที่ต้องการค้นก่อน", pending: "เริ่มค้นแล้ว",
    timeout: "ยังค้นข้อมูลไม่เสร็จ", reviewed: count => `ได้ข้อมูลเพิ่ม ${count} แหล่ง รอผู้ตรวจ`,
  },
  en: {
    failure: "Couldn't look up more sources.", noSources: "No additional sources found.",
    noSegment: "Select a route segment first.", pending: "Looking up sources…",
    timeout: "Research hasn't finished yet.", reviewed: count => `${count} source(s) found, pending review.`,
  },
};

export const researchSegmentTool = {
  name: "research_segment",
  description: "ค้นข้อมูลสาธารณะเรื่องไฟถนนของช่วงทางที่แอปเลือก เมื่อผู้เดินขอให้ค้นเพิ่ม",
};

function statusText({ status, sourceCount }, copy) {
  if (status === "pending_review" && Number.isInteger(sourceCount) && sourceCount >= 1 && sourceCount <= 3) {
    return copy.reviewed(sourceCount);
  }
  if (status === "no_sources") return copy.noSources;
  return copy.failure;
}

function sleep(ms, signal) {
  return new Promise(resolve => {
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
}

export function createResearchClientTool({ getSelectedSegmentId, getDatasetVersion, announce, signal, proxyFetch = fetch, pollMs = 5000, language = "th" }) {
  const copy = messages[language];
  const tracking = new Set();

  async function track(id) {
    const lifetime = AbortSignal.timeout(5 * 60 * 1000);
    const pollSignal = AbortSignal.any([lifetime, ...(signal ? [signal] : [])]);
    try {
      while (!pollSignal.aborted) {
        await sleep(pollMs, pollSignal);
        if (pollSignal.aborted) break;
        let text;
        try {
          const response = await proxyFetch(`${route}/${id}`, { signal: pollSignal, cache: "no-store" });
          if (response.status === 429 || response.status >= 500) continue;
          const job = response.ok ? await response.json() : { status: "failed" };
          if (waiting(job.status)) continue;
          text = statusText(job, copy);
        } catch {
          continue;
        }
        if (!pollSignal.aborted) await announce(text);
        return;
      }
      if (!signal?.aborted) await announce(copy.timeout);
    } finally {
      tracking.delete(id);
    }
  }

  return async function research_segment() {
    const segmentId = getSelectedSegmentId();
    const reply = (status, speak_text) => JSON.stringify({ status, speak_text });
    if (!segmentId) return reply("no_segment", copy.noSegment);
    try {
      const timeout = AbortSignal.timeout(5000);
      const response = await proxyFetch(route, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segmentId, datasetVersion: getDatasetVersion?.() }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) return reply("failed", copy.failure);
      const job = await response.json();
      if (!waiting(job.status)) return reply(job.status, statusText(job, copy));
      if (typeof job.id !== "string" || !/^[a-f0-9-]{36}$/.test(job.id)) return reply("failed", copy.failure);
      if (!tracking.has(job.id)) {
        tracking.add(job.id);
        void track(job.id).catch(() => {});
      }
      return reply("started", copy.pending);
    } catch {
      return reply("failed", copy.failure);
    }
  };
}
