import { expect, test, type Page } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

/** Today is the side panel on desktop and a bottom sheet on phones. */
async function pickToday(page: Page, name: RegExp) {
  if (isPhone(page)) await page.getByRole('button', { name: /^Today/ }).click();
  await page.getByRole('button', { name }).click();
}

test('the heartbeat renders, switches lenses and matches the list view', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/', 'demo-facilitator');
  const stage = page.getByTestId('heartbeat');
  await expect(stage).toBeVisible();
  await expect(stage).toHaveAttribute('data-lens', 'now');
  await expect(stage).toHaveAttribute('data-rhythm', 'steady');
  await expect(page.getByTestId('gauge-lost')).toHaveAttribute('data-count', '2');
  await expect(page.getByTestId('pulse-caption')).toBeVisible();
  await assertNoHorizontalScroll(page);

  // 2: all modules, one column per module.
  await page.keyboard.press('2');
  await expect(stage).toHaveAttribute('data-lens', 'modules');
  const cols = page.getByTestId('module-col');
  await expect(cols).toHaveCount(4);
  await expect(cols.nth(0)).toHaveAttribute('data-state', 'done');
  await expect(cols.nth(1)).toHaveAttribute('data-state', 'current');
  await expect(cols.nth(2)).toHaveAttribute('data-state', 'upcoming');

  // 3: the trend over the session.
  await page.getByRole('radio', { name: /Trend/ }).click();
  await expect(stage).toHaveAttribute('data-lens', 'trend');

  // The list view carries the same totals.
  await page.getByRole('radio', { name: 'List' }).click();
  await expect(page.getByTestId('pulse-list')).toBeVisible();
  await expect(page.getByTestId('list-lost')).toHaveText('2');
  await expect(page.getByTestId('list-unsure')).toHaveText('2');
  await expect(page.getByTestId('list-got_it')).toHaveText('3');
  await expect(page.getByTestId('list-none')).toHaveText('3');
  await expect(page.getByTestId('pulse-list')).toContainText('Day 1 recap');
  await assertNoHorizontalScroll(page);
  await page.getByRole('radio', { name: 'Pulse' }).click();
  await expect(stage).toBeVisible();
  consoleWatch.assertClean();
});

test('Today items focus the heartbeat', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/', 'demo-facilitator');
  const stage = page.getByTestId('heartbeat');
  await expect(stage).toBeVisible();

  await pickToday(page, /have not answered yet/);
  await expect(stage).toHaveAttribute('data-focus', 'lane:none');
  await expect(page.getByTestId('gauge-none')).toHaveAttribute('aria-pressed', 'true');

  await pickToday(page, /Most confusing so far: Planning and reasoning/);
  await expect(stage).toHaveAttribute('data-lens', 'modules');
  await expect(stage).toHaveAttribute('data-focus', /^module:/);

  await pickToday(page, /notes on this module/);
  await expect(stage).toHaveAttribute('data-focus', 'notes');
  await expect(page.getByTestId('notes-moment')).toContainText('Is chain-of-thought the same as planning?');
  await page.keyboard.press('Escape');
  await expect(stage).toHaveAttribute('data-focus', '');
  consoleWatch.assertClean();
});

test('the pause moment appears at 30% lost and focuses the lost band', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/join/PULSE7', 'demo-sam');
  await page.getByRole('button', { name: /^Lost/ }).click();
  await expect(page.getByTestId('you-said')).toContainText('You said: Lost');

  await openApp(page, '/', 'demo-facilitator');
  const stage = page.getByTestId('heartbeat');
  await expect(stage).toHaveAttribute('data-rhythm', 'alert');
  const moment = page.getByTestId('alert-moment');
  await expect(moment).toContainText('Consider pausing');
  await expect(moment).toContainText('3 of 10 are lost');
  await moment.getByRole('button', { name: 'Show the lost band' }).click();
  await expect(stage).toHaveAttribute('data-focus', 'lane:lost');
  await moment.getByRole('button', { name: 'Keep going' }).click();
  await expect(moment).toBeHidden();
  consoleWatch.assertClean();
});

test('view as room screen hides notes and shows the join code', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/', 'demo-facilitator');
  await expect(page.getByTestId('notes-list')).toHaveCount(1);
  await page.getByRole('radio', { name: 'Room' }).click();
  await expect(page.getByText('Check in with code')).toBeVisible();
  await expect(page.getByTestId('notes-list')).toHaveCount(0);
  await page.keyboard.press('v');
  await expect(page.getByTestId('notes-list')).toHaveCount(1);
  consoleWatch.assertClean();
});

test('without WebGL the heartbeat still draws, with a CSS room light', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await page.goto('/?as=demo-facilitator&nowebgl#/');
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  const stage = page.getByTestId('heartbeat');
  await expect(stage).toHaveAttribute('data-renderer', 'css');
  await expect(page.getByTestId('gauge-got_it')).toHaveAttribute('data-count', '3');
  await page.keyboard.press('3');
  await expect(stage).toHaveAttribute('data-lens', 'trend');
  consoleWatch.assertClean();
});

test('the keyboard cheat sheet opens with ?', async ({ page }) => {
  await openApp(page, '/', 'demo-facilitator');
  await expect(page.getByTestId('heartbeat')).toBeVisible();
  await page.keyboard.press('Shift+?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Next module');
});

test('with reduced motion the heartbeat draws a still frame with the same totals', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page, '/', 'demo-facilitator');
  await expect(page.getByTestId('heartbeat')).toBeVisible();
  await expect(page.getByTestId('gauge-unsure')).toHaveAttribute('data-count', '2');
  await page.keyboard.press('2');
  await expect(page.getByTestId('module-col')).toHaveCount(4);
  consoleWatch.assertClean();
});
