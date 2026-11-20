import { expect, test } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

test('loads, creates a record, sees it listed, no console errors', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  // The facilitator's home is the pulse of their live session.
  await openApp(page, '/');
  await expect(page.getByRole('heading', { name: 'AI Agents Bootcamp: Day 2 (demo)', level: 1 })).toBeVisible();
  await expect(page.getByTestId('heartbeat')).toBeVisible();
  await assertNoHorizontalScroll(page);

  await openApp(page, '/sessions');
  await expect(page.getByTestId('hosted-sessions')).toContainText('AI Agents Bootcamp: Day 2 (demo)');
  await assertNoHorizontalScroll(page);

  await page.getByRole('main').getByRole('link', { name: 'New session' }).click();
  await page.getByLabel('Session title').fill('Smoke test cohort');
  await page.getByLabel('Modules, one per line').fill('Kick-off\nDeep dive\nWrap-up');
  await expect(page.getByText('3 modules: Kick-off → Deep dive → Wrap-up')).toBeVisible();
  await page.getByRole('button', { name: 'Create session' }).click();

  await expect(page.getByRole('heading', { name: 'Smoke test cohort', level: 1 })).toBeVisible();
  await expect(page.getByTestId('join-code')).toHaveText(/^[A-Z2-9]{6}$/);
  await expect(page.getByTestId('alert-banner')).toHaveAttribute('data-kind', 'waiting');
  await assertNoHorizontalScroll(page);

  await openApp(page, '/sessions');
  await expect(page.getByTestId('hosted-sessions')).toContainText('Smoke test cohort');
  consoleWatch.assertClean();
});

test('a participant lands on check-in', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/', 'demo-jamie');
  await expect(page.getByRole('heading', { name: 'Join your session', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Join code')).toBeVisible();
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});
