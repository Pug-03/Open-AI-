import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { AgenticProgress } from './AgenticProgress.tsx';

test('announces only the active step and leaves later steps pending', () => {
  const html = renderToStaticMarkup(
    <AgenticProgress lang="th" busy stages={{ routes: 'done', evidence: 'working' }} />,
  );

  expect(html).toContain('role="status">รวบรวมหลักฐาน กำลังทำ');
  expect(html).toContain('data-stage="evidence" data-stage-state="working" aria-current="step"');
  expect(html).toContain('data-stage="critique" data-stage-state="pending"');
});

test('identifies fallback, skipped, and unfinished stages after a run', () => {
  const html = renderToStaticMarkup(
    <AgenticProgress lang="en" busy={false} source="worker" stages={{ routes: 'done', evidence: 'fallback', review: 'working' }} />,
  );

  expect(html).toContain('data-stage="evidence" data-stage-state="fallback"');
  expect(html).toContain('data-stage="review" data-stage-state="interrupted"');
  expect(html).toContain('data-stage="critique" data-stage-state="skipped"');
  expect(html).not.toContain('aria-current');
});
