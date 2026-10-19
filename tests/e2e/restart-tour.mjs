/**
 * Focused check: "Restart tutorial" works from Settings and from Reports → Help & guide.
 *   BASE_URL=http://localhost:4199 node tests/e2e/restart-tour.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4199';
const exe = process.env.PW_CHROMIUM ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '✓' : '✗'} ${msg}`); };

const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();

await page.goto(`${BASE}/login`);
await page.getByRole('button', { name: 'Register' }).click();
await page.getByLabel('Your name').fill('Tour Checker');
await page.getByLabel('Email').fill(`tourcheck-${Date.now()}@example.com`);
await page.getByLabel('Password').fill('long-enough-pass');
await page.getByRole('button', { name: 'Create account' }).click();
await page.waitForURL('**/worlds');
await page.getByRole('button', { name: 'Consumer electronics' }).click();
await page.waitForURL('**/overview', { timeout: 60000 });

// dismiss the auto-started tour for this new user
const tourDialog = page.locator('.tour-root');
await tourDialog.waitFor({ timeout: 5000 });
await tourDialog.getByRole('button', { name: 'Skip' }).click();
check((await page.locator('.tour-root').count()) === 0, 'auto-tour dismissed');

const base = page.url().replace(/\/overview.*$/, '');

// Settings → Restart tutorial
await page.goto(`${base}/settings`);
await page.getByRole('button', { name: 'Restart tutorial' }).click();
await tourDialog.waitFor({ timeout: 5000 });
check(await page.getByText('Welcome to REALWORLD').isVisible(), 'Settings → Restart tutorial opens the tour');
await tourDialog.getByRole('button', { name: 'Skip' }).click();
check((await page.locator('.tour-root').count()) === 0, 'tour dismissed again');

// Reports → Help & guide → Restart tutorial
await page.goto(`${base}/reports?tab=guide`);
await page.getByRole('tab', { name: 'How it works' }).click();
await page.getByRole('button', { name: 'Restart tutorial' }).click();
await tourDialog.waitFor({ timeout: 5000 });
check(await page.getByText('Welcome to REALWORLD').isVisible(), 'Reports → Help & guide → Restart tutorial opens the tour');
await tourDialog.getByRole('button', { name: 'Skip' }).click();

await browser.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log('\nAll restart-tour checks passed');
