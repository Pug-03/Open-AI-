import type { RouteEvidenceSegment, WalkMode } from '@walkwe/core';

export const evidenceKinds = ['go', 'caution', 'avoid'] as const;

type EvidenceKind = typeof evidenceKinds[number];
type Reason = 'covered' | 'shade' | 'sun' | 'lit' | 'dark' | 'lamp' | 'unknown-light' | 'no-sidewalk';

export interface EvidenceRow {
  kind: EvidenceKind;
  reason: Reason;
  name: string;
  offset: number;
  length: number;
}

function classify(segment: RouteEvidenceSegment, mode: WalkMode): Reason | undefined {
  if (segment.noSidewalk) return 'no-sidewalk';
  if (mode === 'night') {
    if (segment.light === 'lit') return 'lit';
    if (segment.light === 'dark') return 'dark';
    return segment.method === 'lamp_proximity' ? 'lamp' : 'unknown-light';
  }
  if (segment.covered === 1) return 'covered';
  if (segment.shaded != null && segment.shaded >= 0.75) return 'shade';
  if (segment.shaded != null && segment.shaded <= 0.25) return 'sun';
}

export function groupEvidence(
  selected: readonly RouteEvidenceSegment[],
  alternate: readonly RouteEvidenceSegment[],
  mode: WalkMode,
): EvidenceRow[] {
  const chosen = new Set(selected.map(segment => segment.id));
  const group = (segments: readonly RouteEvidenceSegment[], alternative: boolean) => {
    const rows: EvidenceRow[] = [];
    let distance = 0;
    for (const segment of segments) {
      const offset = distance;
      distance += segment.length;
      if (alternative && chosen.has(segment.id)) continue;
      const reason = classify(segment, mode);
      if (!reason) continue;
      const positive = reason === 'covered' || reason === 'shade' || reason === 'lit';
      if (alternative && reason !== 'no-sidewalk' && reason !== 'dark' && reason !== 'sun') continue;
      const kind = alternative ? 'avoid' : positive ? 'go' : 'caution';
      const name = segment.name || '';
      const last = rows.at(-1);
      if (last?.reason === reason && last.name === name && Math.abs(last.offset + last.length - offset) < 0.01) {
        last.length += segment.length;
      } else {
        rows.push({ kind, reason, name, offset, length: segment.length });
      }
    }
    return rows;
  };
  return [...group(selected, false), ...group(alternate, true)];
}
