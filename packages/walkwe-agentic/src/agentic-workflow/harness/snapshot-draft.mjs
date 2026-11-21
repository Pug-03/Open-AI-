const copy = {
  th: {
    duration: "เดินประมาณ {duration_min} นาที",
    sun_exposure: "คาดว่าโดนแดด {sun_min} นาที",
    lighting_coverage: "ช่วงที่มีข้อมูลว่ามีไฟ {known_lit_m} เมตร",
    unknown: "บางช่วงยังไม่มีข้อมูลไฟ",
    stale: "หลักฐานบางรายการเก่าหรือไม่ตรงกับเวลาเดิน",
    reported: "หลักฐานบางรายการมาจากผู้ใช้รายงาน",
    error: "เครื่องมือบางตัวขัดข้อง",
    card: "ดูข้อมูลเส้นทาง",
  },
  en: {
    duration: "Estimated walk: {duration_min} minutes",
    sun_exposure: "Estimated sun exposure: {sun_min} minutes",
    lighting_coverage: "Mapped as lit for {known_lit_m} metres",
    unknown: "Some segments have missing lighting data",
    stale: "Some evidence is outdated",
    reported: "Some evidence was reported by a user",
    error: "A tool was unavailable",
    card: "See route details",
  },
};
const extraClaim = {
  sun_exposure: { claim_id: "sun_exposure", kind: "sun_minutes", placeholders: ["{sun_min}"] },
  lighting_coverage: { claim_id: "lighting_coverage", kind: "other", placeholders: ["{known_lit_m}"] },
};

export function draftFromSnapshot(snapshot, language, emphasis, toolErrors) {
  const { stress, routes, deciding_evidence: deciding } = snapshot;
  const chosen = routes.find(route => route.route_id === stress.recommended_route_id);
  const wording = copy[language];
  const missing = stress.mode === "night" && (stress.flips || chosen.metrics.unknown_m > 0);
  const evidenceIds = [chosen.evidence_id];
  const claims = [{ claim_id: "duration", kind: "other", evidence_ids: evidenceIds, placeholders: ["{duration_min}"] }];
  if (extraClaim[emphasis]) claims.push({ ...extraClaim[emphasis], evidence_ids: evidenceIds });
  if (deciding.length) claims.push({
    claim_id: "lighting_gap", kind: "lighting_unknown", evidence_ids: deciding.map(row => row.evidence_id), placeholders: [],
  });

  const text = [
    missing && wording.unknown,
    wording.duration,
    extraClaim[emphasis] && wording[emphasis],
    deciding.some(row => row.stale) && wording.stale,
    deciding.some(row => row.trust === "user_reported") && wording.reported,
    toolErrors.length > 0 && wording.error,
  ].filter(Boolean).join(language === "en" ? ". " : " ");
  return {
    decision: stress.decision, verdict: stress.verdict, recommended_route_id: chosen.route_id,
    depends_on_segment_ids: stress.depends_on.map(row => row.segment_id),
    claims, text, card_notes: routes.map(({ route_id, trust }) => ({ route_id, trust, note: wording.card })),
    unknowns: missing ? ["lighting"] : [], language,
    tool_errors_acknowledged: toolErrors,
  };
}
