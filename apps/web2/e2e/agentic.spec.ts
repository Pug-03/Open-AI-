import { asReturningUser, expect, test } from './fixtures.ts';

const proxy = process.env.VITE_AI_PROXY_URL?.replace(/\/$/, '');
const from = 'bts:CEN';
const to = 'osm:W157482067';
const phrase = 'BTS Siam to CentralWorld at 8 pm';

test('public-place draft and one night clarification preserve the selected map route', async ({ page, context }) => {
  test.skip(!proxy, 'Build with VITE_AI_PROXY_URL=http://localhost:4174 to exercise the intercepted proxy.');
  await asReturningUser(page, { ww_lang: 'en' });
  await page.clock.install({ time: new Date('2026-10-15T14:00:00+07:00') });
  await page.clock.resume();

  let intentCalls = 0;
  const planCalls: unknown[] = [];
  const cors = {
    'access-control-allow-origin': process.env.WALKWE_TEST_APP_ORIGIN ?? 'http://localhost:4175',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
  await context.route(`${proxy}/agentic/*`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const input = request.postDataJSON();
    if (request.url().endsWith('/intent')) {
      expect(input).toEqual({ text: phrase, language: 'en' });
      intentCalls += 1;
      await route.fulfill({ headers: cors, json: {
        status: 'confirm', from: intentCalls === 1 ? 'not-a-public-landmark' : from,
        to, time: '20:00', mode: 'night', noStairs: false, source: 'gpt-6.1-terra',
      } });
      return;
    }
    expect(request.url()).toBe(`${proxy}/agentic/plan`);
    expect(request.headers().accept).toBe('application/x-ndjson');
    planCalls.push(input);
    const answered = input.preference === 'prefer_evidence';
    const result = {
      status: 'ok', datasetVersion: 'test-web2-snapshot', provenance: 'public_web2_graph', source: answered ? 'worker' : 'verified_planner',
      decision: answered ? 'ACT' : 'VERIFY',
      text: answered ? 'Review updated using the better-documented route.' : 'Some lighting evidence is missing.',
      recommendedId: answered ? 'evidence-route' : 'direct-route', evidenceIds: ['lighting:unknown-crossing'],
      routes: [
        { id: 'direct-route', meters: 311, lit: 32, unknown: 279, minutes: 4, sunMinutes: null },
        { id: 'evidence-route', meters: 316, lit: 156, unknown: 160, minutes: 4, sunMinutes: null },
      ],
      clarification: {
        id: 'night_lighting_preference', text: 'Which lighting preference should the review use?',
        options: [
          { label: 'Take the direct route', value: 'direct', ref: 'direct-route' },
          { label: 'Prefer more lighting evidence', value: 'prefer_evidence', ref: 'evidence-route' },
        ],
      },
      trace: answered ? [] : [{ step: 'get_segment_evidence', status: 'ok' }, { step: 'verify', passed: true }, { step: 'critic', passed: true }],
    };
    if (answered) await route.fulfill({ headers: cors, json: result });
    else {
      const events = ['routes', 'evidence', 'review', 'critique'].flatMap(stage => ['working', 'done']
        .map(state => ({ type: 'progress', stage, state })));
      await route.fulfill({
        headers: cors, contentType: 'application/x-ndjson',
        body: [...events, { type: 'result', result }].map(event => JSON.stringify(event)).join('\n') + '\n',
      });
    }
  });

  await page.goto('/plan');
  const ask = page.getByTestId('agentic-ask');
  await ask.getByRole('textbox', { name: 'Describe your walk' }).fill(phrase);
  await ask.getByRole('button', { name: 'Fill trip details' }).click();
  await expect(ask.getByRole('status')).toHaveText('Trip parsing is unavailable. Pick your places on the map.');
  await expect(page.getByTestId('ready')).toHaveCount(0);

  await ask.getByRole('button', { name: 'Fill trip details' }).click();
  await expect(ask.getByRole('status')).toHaveText('Check the places and time, then tap See routes.');
  await expect(ask).toContainText('AI extracted places, time and constraints from your request.');
  await expect(page.getByTestId('point-from')).toContainText('BTS Siam');
  await expect(page.getByTestId('point-to')).toContainText('centralwOrld');
  await expect(page.getByTestId('mode-night')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('walk-time-input')).toHaveValue('2026-10-15T20:00');
  await expect(page.locator('.route-option')).toHaveCount(0);
  expect(planCalls).toHaveLength(0);

  await page.getByTestId('find-routes').click();
  await expect(page.locator('.route-option').first()).toBeVisible({ timeout: 15_000 });
  const selected = page.locator('.route-option[aria-pressed="true"]');
  const selectedId = await selected.getAttribute('data-testid');
  expect(selectedId).toMatch(/^route-/);
  await expect(page.getByTestId('route-evidence')).toBeVisible();
  const review = page.getByTestId('agentic-review');
  await review.getByRole('button', { name: 'Review evidence', exact: true }).click();
  await expect(review).toContainText('Some lighting evidence is missing.');
  await expect(review.locator('[data-stage][data-stage-state="done"]')).toHaveCount(4);
  await expect(review.locator('.agentic-route-metrics')).toContainText('279 m');
  await review.getByText('Evidence segment IDs').click();
  await expect(review.getByText('lighting:unknown-crossing')).toBeVisible();
  expect(planCalls).toEqual([{ from, to, time: '20:00', date: '2026-10-15', mode: 'night', language: 'en', noStairs: false }]);

  await review.getByRole('button', { name: 'Prefer more lighting evidence' }).click();
  await expect(review).toContainText('Review updated using the better-documented route.');
  await expect(review).toContainText('The suggestion changed with your choice about unverified lighting.');
  await expect(review.locator('.agentic-route-metrics')).toContainText('160 m');
  await expect(review.locator('.agentic-route-metrics')).toContainText('Previously 279 m');
  await expect(review.locator('[data-stage="review"]')).toHaveAttribute('data-stage-state', 'fallback');
  await expect(review.locator('[data-stage="critique"]')).toHaveAttribute('data-stage-state', 'skipped');
  await expect(review.getByRole('button', { name: 'Prefer more lighting evidence' })).toHaveCount(0);
  await expect(selected).toHaveAttribute('data-testid', selectedId!);
  await expect(page.getByTestId('start-nav')).toBeEnabled();
  expect(intentCalls).toBe(2);
  expect(planCalls).toHaveLength(2);
  expect(planCalls[1]).toEqual({ ...(planCalls[0] as object), preference: 'prefer_evidence' });
  const steps = review.getByRole('list', { name: 'Route review steps' });
  await steps.scrollIntoViewIfNeeded();
  await expect(steps).toBeInViewport();
});
