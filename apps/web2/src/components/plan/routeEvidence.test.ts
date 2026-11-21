import { expect, it } from 'vitest';
import type { RouteEvidenceSegment } from '@walkwe/core';
import { groupEvidence } from './routeEvidence';

const segment = (id: string, evidence: Partial<RouteEvidenceSegment> = {}): RouteEvidenceSegment => ({
  id, length: 20, light: 'unknown', method: 'no_data', stairs: false, covered: 0, ...evidence,
});

it('keeps nearby lamps and unknown lighting separate from mapped lighting', () => {
  const lamp = { method: 'lamp_proximity', name: 'Rama I' } as const;
  const rows = groupEvidence([
    segment('1', lamp), segment('2', lamp), segment('3'),
    segment('4', { light: 'lit', method: 'osm_lit_tag' }),
  ], [segment('2', { noSidewalk: true }), segment('5', { light: 'dark', method: 'osm_lit_tag' })], 'night');
  expect(rows).toEqual([
    { kind: 'caution', reason: 'lamp', name: 'Rama I', offset: 0, length: 40 },
    { kind: 'caution', reason: 'unknown-light', name: '', offset: 40, length: 20 },
    { kind: 'go', reason: 'lit', name: '', offset: 60, length: 20 },
    { kind: 'avoid', reason: 'dark', name: '', offset: 20, length: 20 },
  ]);
});

it('labels mapped cover and estimated shade only when the worker supplied them', () => {
  const rows = groupEvidence([
    segment('1', { covered: 1 }), segment('2', { shaded: 0.9 }), segment('3'),
  ], [segment('4', { shaded: 0.1 })], 'day');
  expect(rows.map(row => [row.kind, row.reason])).toEqual([
    ['go', 'covered'], ['go', 'shade'], ['avoid', 'sun'],
  ]);
});
