import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4199';
const shots = process.argv[2];
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
const snap = async (name) => shots && (await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false }));
const snapFull = async (name) => shots && (await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }));

// 1. fresh register -> land on Worlds page (first thing a brand new user sees)
await page.goto(`${BASE}/login`);
await page.getByRole('button', { name: 'Register' }).click();
await page.getByLabel('Your name').fill('Audit User');
await page.getByLabel('Email').fill(`audit-${Date.now()}@example.com`);
await page.getByLabel('Password').fill('long-enough-pass');
await page.getByRole('button', { name: 'Create account' }).click();
await page.waitForURL('**/worlds');
await page.waitForTimeout(800);
await snapFull('A1-worlds-empty');
console.log('WORLDS PAGE TEXT:\n', (await page.locator('body').innerText()).slice(0, 2000));

// 2. click New World
await page.getByRole('button', { name: 'New world' }).click();
await page.waitForTimeout(300);
await snap('A2-new-world-modal');

// cancel, instead go the demo route to see a populated app fast
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Consumer electronics' }).click();
await page.waitForURL('**/overview', { timeout: 60000 });
await page.waitForTimeout(2000);
await snapFull('A3-overview-demo');
console.log('\nOVERVIEW PAGE TEXT:\n', (await page.locator('body').innerText()).slice(0, 3000));

// 3. check nav groups text
console.log('\nNAV TEXT:\n', await page.locator('.sidebar').innerText());

// 4. New company wizard (fresh world)
await page.goto(`${BASE}/worlds`);
await page.getByRole('button', { name: 'New world' }).click();
await page.getByLabel('World name').fill('Audit world 2');
await page.getByRole('button', { name: 'Create world' }).click();
await page.waitForURL('**/new-company', { timeout: 20000 });
await page.waitForTimeout(600);
await snapFull('A4-new-company-step1');
console.log('\nNEW COMPANY STEP1 TEXT:\n', (await page.locator('body').innerText()).slice(0, 1500));

await browser.close();
