/**
 * End-to-end smoke test of critical user flows against a running server.
 *   BASE_URL=http://localhost:4100 node tests/e2e/flow.mjs [screenshotDir]
 * Uses playwright-core with the system Chromium (PW_CHROMIUM or /opt/pw-browsers).
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:4100';
const shots = process.argv[2];
const exe = process.env.PW_CHROMIUM ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
const MODULES = ['overview', 'events', 'company', 'workforce', 'manufacturing', 'inventory', 'supply-chain', 'rnd', 'marketing', 'sales', 'markets', 'finance', 'investments', 'transactions', 'countries', 'trade', 'economics', 'law', 'reports', 'settings'];

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
};

const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('401') && errors.push(`console: ${m.text()}`));
const snap = async (name) => shots && (await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: false }));

// register
await page.goto(`${BASE}/login`);
await page.getByRole('button', { name: 'Register' }).click();
await page.getByLabel('Your name').fill('E2E Player');
await page.getByLabel('Email').fill(`e2e-${Date.now()}@example.com`);
await page.getByLabel('Password').fill('long-enough-pass');
await page.getByRole('button', { name: 'Create account' }).click();
await page.waitForURL('**/worlds');
check(true, 'registered and redirected to worlds');

// demo world
await page.getByRole('button', { name: 'Consumer electronics' }).click();
await page.waitForURL('**/overview', { timeout: 60000 });
await page.getByRole('heading', { name: 'World overview' }).waitFor();
check(await page.getByRole('heading', { name: 'Needs attention' }).isVisible(), 'overview shows Needs attention');
check((await page.locator('.kpi').count()) === 4, 'overview has 4 KPI tiles');
await page.waitForTimeout(2500);
await snap('01-overview');

// KPI drill-down
await page.locator('.kpi').first().click();
await page.getByRole('dialog').getByText('Definition').waitFor();
check(await page.getByRole('dialog').getByText('Underlying journal lines').isVisible(), 'cash KPI drawer shows journal lines');
await snap('02-kpi-drawer');
await page.keyboard.press('Escape');

// campus hotspot (keyboard-accessible button)
const hotspot = page.locator('.campus-hud .hotspot').first();
await hotspot.click();
check(await page.locator('.campus-panel').isVisible(), 'campus hotspot opens context panel');

// every module renders without error states
const base = page.url().replace(/\/overview.*$/, '');
for (const m of MODULES) {
  await page.goto(`${base}/${m}`);
  await page.locator('h1').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  const crashed = await page.getByText('Something went wrong').count();
  check(crashed === 0, `module ${m} renders`);
  if (['finance', 'manufacturing', 'supply-chain', 'rnd', 'countries', 'reports', 'markets', 'transactions'].includes(m)) await snap(`10-${m}`);
}

// place a purchase order
await page.goto(`${base}/supply-chain`);
await page.getByRole('tab', { name: 'Purchase orders' }).click();
await page.getByLabel('Quantity').fill('500');
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Place order' }).click();
await page.locator('.toast').first().waitFor();
check((await page.locator('.toast').first().textContent())?.includes('PO-'), 'purchase order placed via UI');

// production plan submit
await page.goto(`${base}/manufacturing`);
await page.getByRole('button', { name: 'Use feasible max' }).click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Validate & submit plan' }).click();
await page.locator('.toast').last().waitFor();
check(!(await page.locator('.toast.error').count()), 'production plan accepted');

// advance a month (preflight → confirm → results)
const tickBefore = await page.locator('.timebox b').textContent();
await page.getByRole('button', { name: 'Run next month' }).click();
await page.getByRole('button', { name: 'Confirm & run month' }).waitFor();
await page.waitForTimeout(800);
await snap('03-advance-preflight');
await page.getByRole('button', { name: 'Confirm & run month' }).click();
await page.getByRole('button', { name: 'Continue' }).waitFor({ timeout: 30000 });
await snap('04-advance-result');
await page.getByRole('button', { name: 'Continue' }).click();
const tickAfter = await page.locator('.timebox b').textContent();
check(tickBefore !== tickAfter, `advance moved time ${tickBefore} → ${tickAfter}`);

// statements reconcile in UI
await page.goto(`${base}/finance`);
await page.getByRole('tab', { name: 'Statements' }).click();
await page.getByText('Assets = L + E').waitFor({ timeout: 15000 });
check(true, 'balance sheet shows balanced badge');

// scenario lab
await page.goto(`${base}/reports`);
await page.getByRole('tab', { name: 'Scenario lab' }).click();
await page.getByRole('button', { name: 'Run scenario vs baseline' }).click();
await page.getByText('Revenue Δ over horizon').waitFor({ timeout: 30000 });
check(true, 'scenario lab compares scenario vs baseline');

// new world + wizard
await page.goto(`${BASE}/worlds`);
await page.getByRole('button', { name: 'New world' }).click();
await page.getByLabel('World name').fill('Wizard world');
await page.getByRole('button', { name: 'Create world' }).click();
await page.waitForURL('**/new-company');
await page.getByRole('button', { name: /Food & Beverage/ }).click();
await page.getByRole('button', { name: 'Continue' }).click();
await page.getByLabel('Registered company name').fill('Koozh Works');
await page.getByLabel('Consumer brand').fill('Koozh');
await page.getByRole('button', { name: 'Continue' }).click();
await page.getByRole('button', { name: 'Continue' }).click();
await page.getByLabel('Founder name').fill('Founder');
for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Continue' }).click();
await snap('05-wizard-review');
await page.getByRole('button', { name: 'Register company' }).click();
await page.waitForURL('**/manufacturing', { timeout: 30000 });
check(true, 'company created through the wizard');

// mobile layout
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${base}/overview`);
await page.locator('h1').first().waitFor();
await page.waitForTimeout(1500);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 1, `no horizontal page scroll on mobile (overflow ${overflow}px)`);
await page.getByRole('button', { name: 'Open navigation' }).click();
check(await page.locator('.sidebar.open').isVisible(), 'mobile navigation drawer opens');
await snap('06-mobile');

check(errors.length === 0, `no console/page errors${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll e2e checks passed');
