import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { box, openLab, resetLab, tab, watch } from './helpers';

// The lab provokes 401, 403, 404 and 410 on purpose; Chromium logs those fetches as console errors.
const PROVOKED = [401, 403, 404, 410];

test.beforeEach(async ({ request }) => {
  await resetLab(request);
});

test.describe('the lab opens without a sign-in screen', () => {
  test('shows the map, the phones and live events, under the strict CSP, with nothing third-party', async ({
    page,
  }) => {
    const problems = watch(page);
    await openLab(page);
    await expect(page.locator('svg.map')).toBeVisible();
    // the phones sign in and start to drive; the first position events arrive through the socket
    await expect(page.getByText(/\d+ position event\(s\) so far/)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.phones-table tbody tr')).toHaveCount(4);
    expect(problems).toEqual([]);
  });

  test('Start over empties the history and brings the fleets back', async ({ page }) => {
    await openLab(page);
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.getByRole('tab', { name: 'Field' })).toBeVisible();
    await expect(page.locator('.phones-table tbody tr')).toHaveCount(4);
  });
});

test.describe('ingest', () => {
  test('a mixed batch keeps the good readings, names the bad ones, and a repeat is all duplicates', async ({
    page,
  }) => {
    const problems = watch(page);
    await openLab(page);
    await tab(page, 'Ingest').click();
    await page.getByLabel('Start from').selectOption({ label: 'Mixed batch: 3 good, 3 bad' });
    await page.getByRole('button', { name: 'Send batch' }).click();
    const first = page.locator('.box.arrive').first();
    await expect(first).toContainText('accepted 3');
    await expect(first).toContainText('rejected 3');
    for (const reason of ['bad_coordinate', 'future', 'too_old']) await expect(first).toContainText(reason);

    await page.getByRole('button', { name: 'Send again' }).click();
    const repeat = page.locator('.box.arrive').first();
    await expect(repeat).toContainText('accepted 0');
    await expect(repeat).toContainText('duplicates 3');

    await page.getByLabel('Start from').selectOption({ label: 'An older reading than the last one' });
    await page.getByRole('button', { name: 'Send batch' }).click();
    await expect(page.locator('.box.arrive').first()).toContainText('position updated: false');
    expect(problems).toEqual([]);
  });

  test('a reading that names another driver is refused whole', async ({ page }) => {
    await openLab(page);
    await tab(page, 'Ingest').click();
    await page.getByLabel('Start from').selectOption({ label: 'A reading that names another driver' });
    await page.getByRole('button', { name: 'Send batch' }).click();
    await expect(page.locator('.box.arrive').first()).toContainText('400');
  });

  test('two hours in a tunnel arrive as one batch and a second send stores nothing new', async ({ page }) => {
    await openLab(page);
    await tab(page, 'Ingest').click();
    await page.getByLabel('Start from').selectOption({ label: 'Two hours in a tunnel (300 readings)' });
    await page.getByRole('button', { name: 'Send batch' }).click();
    await expect(page.locator('.box.arrive').first()).toContainText('accepted 300');
    await page.getByRole('button', { name: 'Send again' }).click();
    await expect(page.locator('.box.arrive').first()).toContainText('duplicates 300');
  });
});

test.describe('queue', () => {
  test('capacity is enforced for "call next" and for "call this one" alike', async ({ page }) => {
    await openLab(page);
    await tab(page, 'Queue').click();
    await page.getByRole('button', { name: 'Add 5 people' }).click();
    await expect(page.locator('.trace li').filter({ hasText: 'waiting' })).toHaveCount(5);
    await page.getByRole('button', { name: 'Call next 5' }).click();
    await expect(page.locator('.trace li').filter({ hasText: 'called' })).toHaveCount(3);
    await expect(page.locator('.trace li').filter({ hasText: 'waiting' })).toHaveCount(2);
    await page
      .locator('.trace li')
      .filter({ hasText: 'waiting' })
      .first()
      .getByRole('button', { name: 'Call' })
      .click();
    await expect(box(page, /2 · Call them/)).toContainText('UNIT_FULL');
  });
});

test.describe('router', () => {
  test('a hostile answer is refused and the ETA says it fell back to a straight line', async ({ page }) => {
    await openLab(page);
    await tab(page, 'Router').click();
    await expect(page.locator('.trace li').filter({ hasText: 'road' }).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Hostile geometry' }).click();
    await page.getByRole('button', { name: 'Ask for an ETA' }).click();
    await expect(page.locator('.trace li').filter({ hasText: 'straight_line' }).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Healthy again' }).click();
    await expect(page.locator('.trace li').filter({ hasText: 'road' }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('a router that is down opens the circuit breaker', async ({ page }) => {
    await openLab(page);
    await tab(page, 'Router').click();
    await page.getByRole('button', { name: 'Down', exact: true }).click();
    for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Ask for an ETA' }).click();
    await expect(box(page, 'What the application knows')).toContainText('open', { timeout: 15_000 });
  });
});

test.describe('boundaries', () => {
  test('another fleet’s trip looks exactly like one that does not exist', async ({ page }) => {
    const problems = watch(page, { allowStatus: PROVOKED });
    await openLab(page);
    await tab(page, 'Boundaries').click();
    await page.getByRole('button', { name: 'Read the other fleet’s trip' }).click();
    await expect(page.getByText(/identical: the other fleet’s trip is indistinguishable/)).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('forged and missing credentials are all refused', async ({ page }) => {
    await openLab(page);
    await tab(page, 'Boundaries').click();
    const results = box(page, 'Responses');
    await page.getByRole('button', { name: 'No token' }).click();
    await page.getByRole('button', { name: 'Token with alg “none”' }).click();
    await page.getByRole('button', { name: 'Token signed with another key' }).click();
    await page.getByRole('button', { name: 'A driver reading the fleet' }).click();
    await expect(results.locator('li')).toHaveCount(4);
    const statuses = await results.locator('li .badge').allTextContents();
    expect(statuses.sort()).toEqual(['401', '401', '401', '403']);
  });

  test('a socket without a token is cut', async ({ page }) => {
    await openLab(page);
    await tab(page, 'Boundaries').click();
    await page.getByRole('button', { name: 'Connect a socket without a token' }).click();
    await expect(box(page, 'Responses')).toContainText(/UNAUTHORIZED|closed by the server|refused/, {
      timeout: 10_000,
    });
  });

  test('only the link the server signed opens; any alteration is the same 403; it ends with a 410', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = watch(page, { allowStatus: PROVOKED });
    await openLab(page);
    await tab(page, 'Boundaries').click();
    const results = box(page, 'Responses');
    await page.getByRole('button', { name: 'Mint a sheet link' }).click();
    await page.getByRole('button', { name: 'Open the link' }).click();
    await expect(results).toContainText('a PDF of');
    for (const name of [
      'Extend the expiry',
      'Point it at the other fleet’s trip',
      'Change one signature character',
    ]) {
      await page.getByRole('button', { name }).click();
    }
    const forbidden = results.locator('li').filter({ hasText: 'INVALID_LINK' });
    await expect(forbidden).toHaveCount(3);
    await expect(page.locator('.countdown')).toHaveText('expired', { timeout: 40_000 });
    await page.getByRole('button', { name: 'Open the link' }).click();
    await expect(results).toContainText('LINK_EXPIRED');
    expect(problems).toEqual([]);
  });
});

test.describe('field', () => {
  test('a phone that goes quiet raises one alert, and reporting again clears it', async ({ page }) => {
    test.setTimeout(180_000);
    await openLab(page);
    await expect(page.locator('.phones-table tbody tr').first()).toContainText('in transit', {
      timeout: 60_000,
    });
    await page.getByLabel('Phone').selectOption({ index: 0 });
    await page.getByRole('button', { name: 'Kill signal' }).click();
    // the demo threshold is one minute of silence
    await page.waitForTimeout(65_000);
    await page.getByRole('button', { name: 'Run the evaluator' }).click();
    const alerts = box(page, 'Alerts');
    await expect(alerts.locator('.trace li').filter({ hasText: 'no_signal' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Run the evaluator' }).click();
    await expect(alerts.locator('.trace li').filter({ hasText: 'no_signal' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(alerts.locator('.trace li').filter({ hasText: 'cleared' })).toHaveCount(1, {
      timeout: 30_000,
    });
  });

  test('a phone that jitters at the edge does not arrive until it drives on', async ({ page }) => {
    test.setTimeout(180_000);
    await openLab(page);
    // after a reset the phones have to sign in and take their trips again before there is a road to jump along
    await expect(page.locator('.phones-table tbody tr').first()).toContainText('in transit', {
      timeout: 60_000,
    });
    await page.getByLabel('Phone').selectOption({ index: 0 });
    await page.getByRole('button', { name: 'Jitter at the edge' }).click();
    await page.getByRole('button', { name: 'Jump to the end' }).click();
    await page.waitForTimeout(25_000);
    await expect(page.locator('.phones-table tbody tr').first()).toContainText('in transit');
    await expect(page.locator('.feed li').filter({ hasText: 'trip.arrived' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Drive on' }).click();
    await expect(page.locator('.feed li').filter({ hasText: 'trip.arrived' })).toHaveCount(1, {
      timeout: 60_000,
    });
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`accessibility: every lab tab has no WCAG A/AA violations (${scheme})`, async ({
    browser,
    request,
  }) => {
    await resetLab(request);
    const context = await browser.newContext({ colorScheme: scheme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await openLab(page);
    for (const name of ['Field', 'Ingest', 'Queue', 'Router', 'Boundaries']) {
      await tab(page, name).click();
      await page.waitForTimeout(800);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        results.violations.map(
          (v) => `${name} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([]);
    }
    await context.close();
  });
}
