import { test } from '@playwright/test';
import { box, leaveSplash, openLab, resetLab, tab } from './helpers';

// Only with SHOTS=1 (`make screenshots`): these are the pictures in the README, taken from the real stack.
test.skip(process.env.SHOTS !== '1', 'screenshots are taken on request');
test.use({
  viewport: { width: 1360, height: 900 },
  colorScheme: 'light',
  contextOptions: { reducedMotion: 'reduce' },
});

const OUT = '../docs/img';

test('landing', async ({ page }) => {
  await page.goto('/');
  await leaveSplash(page);
  await page.screenshot({ path: `${OUT}/landing.png` });
});

test('lab: the live map', async ({ page, request }) => {
  await resetLab(request);
  await page.setViewportSize({ width: 1360, height: 1560 }); // tall enough for the map, the phones and the event feed
  await openLab(page);
  await page.waitForTimeout(25_000); // let the phones sign in, accept their trips and leave a trail
  await page.screenshot({ path: `${OUT}/lab-map.png` });
});

test('lab: a bad batch', async ({ page, request }) => {
  await resetLab(request);
  await openLab(page);
  await tab(page, 'Ingest').click();
  await page.getByLabel('Start from').selectOption({ label: 'Mixed batch: 3 good, 3 bad' });
  await page.getByRole('button', { name: 'Send batch' }).click();
  await page.getByRole('button', { name: 'Send again' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/lab-ingest.png` });
});

test('lab: the van is full', async ({ page, request }) => {
  await resetLab(request);
  await openLab(page);
  await tab(page, 'Queue').click();
  await page.getByRole('button', { name: 'Add 5 people' }).click();
  await page.getByRole('button', { name: 'Call next 5' }).click();
  await page
    .locator('.trace li')
    .filter({ hasText: 'waiting' })
    .first()
    .getByRole('button', { name: 'Call' })
    .click();
  await box(page, /2 · Call them/).scrollIntoViewIfNeeded();
  await page.waitForTimeout(3500); // let the toasts leave
  await page.screenshot({ path: `${OUT}/lab-queue.png` });
});
