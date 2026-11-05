import { type APIRequestContext, type Page, expect } from '@playwright/test';

const BASE = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:8400');

/** Collects what would make a reviewer frown: console errors, page errors (CSP violations land here) and third-party calls. */
export function watch(page: Page, { allowStatus = [] as number[] } = {}): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    // Chromium logs every non-2xx fetch as an error. The lab provokes some on purpose; allow only the listed ones.
    const status = /status of (\d{3})/.exec(m.text());
    if (status && allowStatus.includes(Number(status[1]))) return;
    problems.push(`console ${m.type()}: ${m.text()}`);
  });
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (
      url.protocol !== 'data:' &&
      url.protocol !== 'blob:' &&
      url.protocol !== 'ws:' &&
      url.host !== BASE.host
    ) {
      problems.push(`third-party request: ${r.url()}`);
    }
  });
  return problems;
}

export async function leaveSplash(page: Page): Promise<void> {
  await expect(page.locator('#splash')).toHaveCount(0, { timeout: 10_000 });
}

/** The lab has no sign-in screen: it signs in as the demo users itself. */
export async function openLab(page: Page, tabName = 'Field'): Promise<void> {
  await page.goto('/lab.html');
  await leaveSplash(page);
  await expect(page.getByRole('tab', { name: tabName })).toBeVisible();
}

/** Every test starts from the lab's own "start over": both fleets re-created, history dropped, router healthy. */
export async function resetLab(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/lab/reset');
  expect(res.ok()).toBeTruthy();
}

export const tab = (page: Page, name: string) => page.getByRole('tab', { name });

/** A box in the lab, found by its heading. */
export const box = (page: Page, heading: string | RegExp) =>
  page.locator('.box').filter({ has: page.getByRole('heading', { name: heading }) });
