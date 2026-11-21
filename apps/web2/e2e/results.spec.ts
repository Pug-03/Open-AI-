import { SIAM, asReturningUser, expect, expectNoHorizontalOverflow, test } from './fixtures.ts';

// Phase 2 "Done when": shade/sun segments visible on the map, on all three
// screen sizes. Time is pinned so the sun (and so the result) is fixed.

const cloud = (pct: number) => ({
  hourly: {
    time: Array.from({ length: 48 }, (_, i) => new Date(Date.UTC(2026, 9, 15) + i * 3_600_000).toISOString().slice(0, 13) + ':00'),
    cloud_cover: Array(48).fill(pct),
  },
});

async function pickWalk(page: import('@playwright/test').Page, query = 'central', destination = /centralwOrld/) {
  await page.getByTestId('point-from').click();
  await page.getByTestId('use-current').click();
  await expect(page.getByRole('heading', { name: 'ไปที่ไหน' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'ค้นหาสถานที่' }).fill(query);
  await page.getByTestId('search-results').getByRole('button', { name: destination }).click();
  await expect(page.getByTestId('ready')).toBeVisible();
}

test.beforeEach(async ({ page, context }) => {
  await asReturningUser(page);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(SIAM);
  await context.route(/api\.open-meteo\.com/, (route) => route.fulfill({ json: cloud(10) }));
});

test('daytime: routes, mapped shade evidence and AI fallback', async ({ page }) => {
  await page.route('**/route-evidence', async (route) => {
    const request = route.request().postDataJSON();
    expect(request.mode).toBe('day');
    expect(Object.keys(request).sort()).toEqual(['candidates', 'mode']);
    expect(Object.keys(request.candidates[0]).sort()).toEqual(['id', 'kind', 'meters', 'reason']);
    await route.fulfill({ json: { ids: [999] }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.clock.install({ time: new Date('2026-10-15T14:00:00+07:00') });
  await page.clock.resume(); // start at that time, then let it run like a real clock
  await page.goto('/plan');
  await pickWalk(page);

  // Auto mode from the time: day.
  await expect(page.getByTestId('mode-day')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('find-routes').click();

  const first = page.locator('.route-option').first();
  await expect(first).toBeVisible({ timeout: 15_000 });
  await expect(first).toHaveAttribute('aria-pressed', 'true'); // shade first: shadiest is the default
  await expect(first).toContainText(/ร่มที่สุด/);
  await expect(first).toContainText(/ร่ม \d+%/);
  await expect(first).toContainText(/นาที/);

  // Rendered on screen: at least one shaded (solid) run and one sunny (dashed) run.
  const map = page.locator('.map-canvas');
  await expect.poll(async () => Number(await map.getAttribute('data-shade-runs')), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect.poll(async () => Number(await map.getAttribute('data-sun-runs')), { timeout: 10_000 }).toBeGreaterThan(0);

  const evidence = page.getByTestId('route-evidence');
  await expect(evidence).toBeVisible();
  await expect(evidence).toContainText('ร่มเงาเป็นค่าคำนวณ');
  await evidence.getByText('ดูหลักฐานรายช่วง').click();
  await expect(evidence.locator('details')).toHaveAttribute('open', '');
  if (process.env.VITE_AI_PROXY_URL) {
    await evidence.getByRole('button', { name: 'ให้ AI เลือกหลักฐานเด่น' }).click();
    await expect(evidence.getByRole('status')).toContainText('AI ยังใช้ไม่ได้');
    await expect(page.getByTestId('start-nav')).toBeEnabled();
  }
  await expect(page.getByText(/ความสูงอาคาร \d+% เป็นค่าประมาณ/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('scheduled for the evening: night lighting evidence and verified AI highlights', async ({ page }) => {
  await page.route('**/route-evidence', async (route) => {
    const { mode, candidates } = route.request().postDataJSON() as {
      mode: string; candidates: { id: number; kind: string }[];
    };
    expect(mode).toBe('night');
    const ids = [...new Map(candidates.map(({ kind, id }) => [kind, id])).values()];
    await route.fulfill({ json: { ids }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.clock.install({ time: new Date('2026-10-15T14:00:00+07:00') });
  await page.clock.resume(); // start at that time, then let it run like a real clock
  await page.goto('/plan');
  await pickWalk(page);

  await page.getByRole('button', { name: 'ตั้งเวลา' }).click();
  await page.getByTestId('walk-time-input').fill('2026-10-15T21:30');
  await expect(page.getByTestId('mode-night')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('find-routes').click();

  await expect(page.locator('.route-option').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.route-option').first()).toContainText(/ปลอดภัยกว่า/);
  await expect(page.getByText('ปลอดภัยกว่า ไม่ใช่การรับประกัน')).toBeVisible();
  const evidence = page.getByTestId('route-evidence');
  await expect(evidence).toContainText(/ยังไม่ทราบ \d+ ม\./);
  await expect(evidence).not.toContainText('ร่มเงา');
  if (process.env.VITE_AI_PROXY_URL) {
    await evidence.getByRole('button', { name: 'ให้ AI เลือกหลักฐานเด่น' }).click();
    await expect(evidence.getByRole('button', { name: 'AI เลือกหลักฐานแล้ว' })).toBeDisabled();
  }

  // Malls close at 21:00–22:00: the router reports skipping them.
  await expect(page.getByText(/เลี่ยงห้างที่ปิดอยู่ตอนนั้น/)).toBeVisible();
});

test('back from results returns to the planner with both points kept', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-15T10:30:00+07:00') });
  await page.clock.resume(); // start at that time, then let it run like a real clock
  await page.goto('/plan');
  await pickWalk(page);
  await page.getByTestId('find-routes').click();
  await expect(page.locator('.route-option').first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'กลับ' }).click();
  await expect(page.getByTestId('point-to')).toHaveAttribute('data-coords', /^13\.74646/); // curated landmark point (landmarks.ts)
});

test('night route research submits the selected edge and shows the pending review count', async ({ page, context }) => {
  const proxy = process.env.VITE_AI_PROXY_URL?.replace(/\/$/, '');
  test.skip(!proxy, 'Build with a mocked research proxy origin.');
  await page.clock.install({ time: new Date('2026-10-15T21:30:00+07:00') });
  await page.clock.resume();
  let selected: string;
  let capability: string | undefined;
  const job = '8be14db7-c823-46c1-a183-e41fad856188';
  const headers = {
    'access-control-allow-origin': process.env.WALKWE_TEST_APP_ORIGIN ?? 'http://localhost:4175',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-walkwe-research-session',
  };

  await context.route(`${proxy}/agents/research**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (request.method() === 'POST') {
      const input = request.postDataJSON();
      expect(input).toEqual({ segmentId: selected, datasetVersion: expect.stringMatching(/^web2:[0-9a-f]{24}$/) });
      capability = request.headers()['x-walkwe-research-session'];
      expect(capability).toMatch(/^[a-f0-9-]{36}$/);
      return route.fulfill({ status: 202, headers, json: { id: job, status: 'starting' } });
    }
    expect(request.url()).toBe(`${proxy}/agents/research/${job}`);
    expect(request.headers()['x-walkwe-research-session']).toBe(capability);
    return route.fulfill({ headers, json: { id: job, status: 'pending_review', sourceCount: 2 } });
  });

  await page.goto('/plan');
  await pickWalk(page, 'ssq1', /สยามสแควร์วัน/);
  await page.getByTestId('find-routes').click();
  const research = page.getByTestId('research-segment');
  const button = research.getByRole('button', { name: 'ค้นแหล่งข้อมูลสาธารณะ' });
  await expect(button).toBeDisabled({ timeout: 15_000 });
  const segment = research.getByRole('combobox');
  selected = await segment.locator('option[value^="edge:"]').first().getAttribute('value') ?? '';
  expect(selected).toMatch(/^edge:\d+$/);
  await segment.selectOption(selected);
  await button.click();
  await expect(research.getByRole('status')).toHaveText('เริ่มค้นแล้ว');
  await expect(research.getByRole('status')).toHaveText('ได้ข้อมูลเพิ่ม 2 แหล่ง รอผู้ตรวจ');
  await expect(page.getByTestId('start-nav')).toBeEnabled();
});
