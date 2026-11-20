import { expect, test, type Page } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

const LIVE = 'AI Agents Bootcamp: Day 2 (demo)';
const CLOSED = 'AI Agents Bootcamp: Day 1 (demo)';
const LIVE_CODE = 'PULSE7';

/** Every participant in the seed (personas other than the facilitator, and the extra participants). */
const PARTICIPANTS = [
  ['demo-sam', 'Sam Taylor'],
  ['demo-priya', 'Priya Shah'],
  ['demo-jamie', 'Jamie Chen'],
  ['demo-p01', 'Morgan Ellis'],
  ['demo-p02', 'Riley Brooks'],
  ['demo-p03', 'Casey Nguyen'],
  ['demo-p04', 'Jordan Park'],
  ['demo-p05', 'Taylor Reed'],
  ['demo-p06', 'Avery Collins'],
  ['demo-p07', 'Quinn Foster'],
  ['demo-p08', 'Drew Patel'],
  ['demo-p09', 'Skyler Moss'],
  ['demo-p10', 'Rowan Hayes'],
  ['demo-p11', 'Elliot Grant'],
] as const;

async function openConsole(page: Page, title = LIVE): Promise<string> {
  await openApp(page, '/sessions', 'demo-facilitator');
  await page.getByRole('link', { name: `Open pulse for ${title}` }).click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  return new URL(page.url()).hash.slice(1);
}

async function openReport(page: Page, title = CLOSED) {
  await openApp(page, '/sessions', 'demo-facilitator');
  await page.getByRole('link', { name: `Session report for ${title}` }).click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
}

/** A band of the heartbeat: its light count and share, as drawn. */
async function expectBand(page: Page, lane: string, count: number, share: number) {
  const band = page.getByTestId(`gauge-${lane}`);
  await expect(band).toHaveAttribute('data-count', String(count));
  await expect(band).toHaveAttribute('data-share', String(share));
}

/** No participant name or id anywhere in the rendered page, visible text or markup. */
async function assertNoParticipantData(page: Page) {
  const text = await page.locator('body').innerText();
  const html = await page.content();
  for (const [sub, name] of PARTICIPANTS) {
    expect(text, `page text shows ${name}`).not.toContain(name);
    expect(html, `page markup carries ${name}`).not.toContain(name);
    expect(html, `page markup carries ${sub}`).not.toContain(sub);
  }
}

test('gauge matches the hand calculation for the seed, and the alert fires at 3 of 10 lost but not 2 of 10', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  const consolePath = await openConsole(page);
  // Seed: 10 active; lost 2, unsure 2, got it 3, no answer yet 3.
  await expect(page.getByTestId('console-module')).toHaveText('Planning and reasoning');
  await expect(page.getByTestId('active-count')).toHaveText('10 active');
  await expectBand(page, 'lost', 2, 20);
  await expectBand(page, 'unsure', 2, 20);
  await expectBand(page, 'got_it', 3, 30);
  await expectBand(page, 'none', 3, 30);
  await expect(page.getByTestId('alert-banner')).toHaveAttribute('data-kind', 'calm');
  await expect(page.getByTestId('alert-banner')).toContainText('2 of 10 are lost');
  await assertNoHorizontalScroll(page);

  // Sam has joined but not answered; one tap on Lost makes it 3 of 10.
  await openApp(page, `/join/${LIVE_CODE}`, 'demo-sam');
  await page.getByRole('button', { name: /^Lost/ }).click();
  await expect(page.getByTestId('you-said')).toContainText('You said: Lost');

  await openApp(page, consolePath, 'demo-facilitator');
  await expect(page.getByTestId('alert-banner')).toHaveAttribute('data-kind', 'alert');
  await expect(page.getByTestId('alert-banner')).toContainText('Consider pausing: 3 of 10 are lost');
  await expect(page.getByTestId('alert-moment')).toContainText('3 of 10 are lost');
  await expectBand(page, 'lost', 3, 30);
  consoleWatch.assertClean();
});

test('participant joins by code, changes their mind, and sees the next module fresh', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/', 'demo-jamie');
  await expect(page.getByTestId('privacy-line')).toHaveText('This app shows your facilitator totals, not names.');

  await page.getByLabel('Join code').fill('abc');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByText('A code is 6 letters and digits')).toBeVisible();

  await page.getByLabel('Join code').fill('zzzzzz');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByText('No session uses the code ZZZZZZ')).toBeVisible();
  await page.getByRole('link', { name: 'Try another code' }).click();

  await page.getByLabel('Join code').fill('pulse7');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByTestId('current-module')).toHaveText('Planning and reasoning');
  await expect(page.getByTestId('you-said')).toHaveText('You have not answered for this module yet.');
  await expect(page.getByTestId('privacy-line')).toBeVisible();

  await page.getByRole('button', { name: /^Unsure/ }).click();
  await expect(page.getByTestId('you-said')).toContainText('You said: Unsure, just now');
  await page.getByRole('button', { name: /^Got it/ }).click();
  await expect(page.getByTestId('you-said')).toContainText('You said: Got it');
  await expect(page.getByRole('button', { name: /^Got it/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^Unsure/ })).toHaveAttribute('aria-pressed', 'false');
  await assertNoHorizontalScroll(page);

  // Jamie is a late joiner, so 11 are active now. The facilitator moves on.
  await openConsole(page);
  await expect(page.getByTestId('active-count')).toHaveText('11 active');
  await page.getByRole('button', { name: /^Next module/ }).click();
  await expect(page.getByTestId('console-module')).toHaveText('Multi-agent patterns');
  await expectBand(page, 'none', 11, 100);

  await openApp(page, `/join/${LIVE_CODE}`, 'demo-jamie');
  await expect(page.getByTestId('current-module')).toHaveText('Multi-agent patterns');
  await expect(page.getByTestId('you-said')).toHaveText('You have not answered for this module yet.');
  consoleWatch.assertClean();
});

test('the host console and the report never show a participant name or id', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, `/join/${LIVE_CODE}`, 'demo-priya');
  await page.getByLabel('Optional note for your facilitator').fill('Please slow down on the planning loop');
  await page.getByRole('button', { name: /^Lost/ }).click();
  await expect(page.getByTestId('you-said')).toContainText('You said: Lost');

  await openConsole(page);
  await expect(page.getByTestId('notes-list')).toContainText('Please slow down on the planning loop');
  await expect(page.getByTestId('heartbeat')).toBeVisible();
  await assertNoParticipantData(page);

  await openReport(page);
  await expect(page.getByTestId('confusion-ranking')).toBeVisible();
  await assertNoParticipantData(page);

  // Close the live session and check its report too.
  await openConsole(page);
  await page.getByRole('button', { name: 'Close session' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close session' }).click();
  await expect(page.getByText('Confusion index = share of responses')).toBeVisible();
  await expect(page.getByRole('heading', { name: LIVE, level: 1 })).toBeVisible();
  await assertNoParticipantData(page);
  consoleWatch.assertClean();
});

test('the report ranks modules by confusion index with the seeded confusing module first', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openReport(page);
  const rows = page.getByTestId('confusion-ranking').locator('tbody tr');
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText('Memory');
  await expect(rows.nth(0)).toContainText('50%');
  const names = await rows.locator('td:nth-child(2)').allInnerTexts();
  expect(names).toEqual(['Memory', 'Guardrails', 'Evaluation', 'Tools and actions', 'Agent anatomy']);
  await expect(page.getByRole('button', { name: 'Copy as Markdown' })).toBeVisible();
  await expect(page.getByTestId('module-bars')).toContainText('Lost at the point where the vector store comes in.');
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});

test('closing mid-module produces a report and ends check-ins for participants', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openConsole(page);
  await page.getByRole('button', { name: 'Close session' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close session' }).click();
  // Planning and reasoning (2 of 7 lost at close) ranks above the Day 1 recap (none lost).
  const rows = page.getByTestId('confusion-ranking').locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Planning and reasoning');
  await expect(rows.first()).toContainText('29%');
  await expect(rows.nth(1)).toContainText('Day 1 recap');
  await expect(page.getByTestId('module-bars')).toContainText('Not run');

  await openApp(page, `/join/${LIVE_CODE}`, 'demo-sam');
  await expect(page.getByText('This session has ended')).toBeVisible();
  consoleWatch.assertClean();
});
