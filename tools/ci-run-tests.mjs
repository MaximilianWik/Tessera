#!/usr/bin/env node
/* CI helper — runs tests.html in headless Chromium via Playwright and exits
 * with a non-zero code if any test failed.
 *
 * Run from the repo root:
 *   npx playwright install --with-deps chromium
 *   node tools/ci-run-tests.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { extname, join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname || new URL('.', import.meta.url).pathname, '..');
const PORT = 8123;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.md':   'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/') urlPath = '/tests.html';
    const fp = join(ROOT, urlPath);
    if (!fp.startsWith(ROOT)) { res.statusCode = 403; res.end(); return; }
    if (!existsSync(fp)) { res.statusCode = 404; res.end('not found: ' + urlPath); return; }
    const st = await stat(fp);
    if (st.isDirectory()) { res.statusCode = 404; res.end(); return; }
    const data = await readFile(fp);
    res.setHeader('content-type', MIME[extname(fp)] || 'application/octet-stream');
    res.end(data);
  } catch (e) {
    res.statusCode = 500; res.end(String(e));
  }
});

await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('[browser console error]', msg.text());
});
page.on('pageerror', (err) => console.error('[browser pageerror]', err));

await page.goto(`http://127.0.0.1:${PORT}/tests.html`);

// The runner kicks off automatically on load; wait for the summary line to
// appear, with a long timeout because the round-trip + damage suites are slow.
await page.waitForSelector('.test-summary', { timeout: 5 * 60 * 1000 });

const summary = await page.locator('.test-summary').first().innerText();
console.log('Test summary:', summary);

const failed = await page.locator('.test-case.fail').count();
const passed = await page.locator('.test-case.pass').count();
const skipped = await page.locator('.test-case.skip').count();

console.log(`Passed: ${passed}, Failed: ${failed}, Skipped: ${skipped}`);

if (failed > 0) {
  // Print all failures
  const failures = await page.locator('.test-case.fail').all();
  for (const f of failures) {
    console.log('\nFAIL:', await f.innerText());
  }
}

await browser.close();
server.close();

process.exit(failed > 0 ? 1 : 0);
