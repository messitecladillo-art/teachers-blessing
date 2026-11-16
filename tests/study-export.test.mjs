import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { renderOfflineLearningHtml } from '../learning/export.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const malicious = '</script><script>window.__exportAttack=9;fetch("https://evil.invalid/script")</script>\u2028\u2029' +
  '\n<img src="https://evil.invalid/image" onerror="window.__exportAttack=7">' +
  '\n<svg onload="window.__exportAttack=8"><image href="https://evil.invalid/svg"/></svg>' +
  '\n<iframe src="https://evil.invalid/frame"></iframe><form action="https://evil.invalid/form"><input autofocus onfocus="window.__exportAttack=6"></form>' +
  '\n<style>body{background:url(https://evil.invalid/css)}</style><audio src="https://evil.invalid/audio"></audio>' +
  '\n\n[unsafe](javascript:window.__exportAttack=5) [reference](https://example.invalid/source)';

test('creates one self-contained document with nonces, escaped source, licenses and data fonts', async () => {
  const html = await renderOfflineLearningHtml({ title: '<img src=x>中文 Ω', content: '# 已保存\n\n$x^2$\n' + malicious });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>&lt;img src=x&gt;中文 Ω<\/title>/);
  const raw = html.match(/<script type="application\/json" id="learning-source" nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(raw).content, '# 已保存\n\n$x^2$\n' + malicious);
  assert.doesNotMatch(raw, /[<\u2028\u2029]/);
  assert.match(raw, /\\u003c\/script>/);
  assert.match(raw, /\\u2028\\u2029/);
  assert.doesNotMatch(html, /<script[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(html, /<link[^>]*\bhref\s*=/i);
  for (const match of html.match(/<style>([\s\S]*?)<\/style>/)[1].matchAll(/url\(([^)]*)\)/g)) assert.ok(match[1].startsWith('data:font/woff2;base64,'));
  assert.match(html, /connect-src &#39;none&#39;/);
  assert.match(html, /font-src data:/);
  assert.match(html, /Marked 15\.0\.12/);
  assert.match(html, /DOMPurify 3\.4\.18/);
  assert.match(html, /KaTeX 0\.19\.1/);
  assert.match(html, /Copyright/);
  assert.match(html, /<noscript>[\s\S]*&lt;script&gt;/);
  const nonces = [...html.matchAll(/<script[^>]+nonce="([^"]+)"/g)].map(match => match[1]);
  assert.ok(nonces.length >= 2 && new Set(nonces).size === 1);
  assert.notEqual(nonces[0], (await renderOfflineLearningHtml({ content: '' })).match(/nonce="([^"]+)"/)[1]);
});

test('rejects invalid or oversized persisted input before attempting fixed asset reads', async () => {
  for (const [input, code] of [
    [null, 'EXPORT_INVALID_INPUT'], [{ content: 12 }, 'EXPORT_INVALID_INPUT'],
    [{ title: 'x'.repeat(241), content: '' }, 'EXPORT_INVALID_INPUT'],
    [{ content: 'x'.repeat(2000001) }, 'EXPORT_TOO_LARGE'],
    [{ content: '中'.repeat(1400000) }, 'EXPORT_TOO_LARGE'],
  ]) await assert.rejects(renderOfflineLearningHtml(input, { root: path.join(root, 'not-an-export-root') }), error => error.status === 400 && error.code === code);
  await assert.rejects(renderOfflineLearningHtml({ content: 'saved' }, { root: path.join(root, 'not-an-export-root') }), error => error.status === 503 && error.code === 'EXPORT_ASSETS_UNAVAILABLE' && !error.message.includes(root));
});

let chromium;
try { ({ chromium } = require('playwright-core')); } catch {}
const chrome = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium');
let chromeAvailable = false;
try { chromeAvailable = (await stat(chrome)).isFile(); } catch {}

test('real file browser renders Markdown/math offline, rejects active content, prints a nonempty PDF, and preserves no-JS source', { skip: !chromium || !chromeAvailable, timeout: 60000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'study-export-'));
  const evidence = path.join(root, '.collab/mentrix/evidence');
  await mkdir(evidence, { recursive: true });
  const body = '## Unicode 教学笔记 Ω 😀\n\n**已保存讲解** 与个人笔记。\n\n行内 $x^2 + y^2 = z^2$。\n\n\\[\\frac{1}{2}+\\frac{1}{2}=1\\]\n\n| 项目 | 数值 |\n|---|---|\n| 合成 | 2 |\n\n' + malicious + '\n\n公式信任边界：$\\href{https://evil.invalid/math}{unsafe}$ $\\includegraphics{https://evil.invalid/katex}$';
  const html = await renderOfflineLearningHtml({ title: '合成离线学习 Ω', content: body });
  const filename = path.join(temp, 'learning.html');
  const budgetFile = path.join(temp, 'math-budget.html');
  await writeFile(filename, html);
  const requests = []; const errors = []; let browser;
  try {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ offline: true, viewport: { width: 1100, height: 900 } });
    await context.route('**/*', async route => {
      const url = route.request().url();
      if ([filename, budgetFile].some(file => url === pathToFileURL(file).href)) return route.continue();
      if (!url.startsWith('data:')) requests.push(url);
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/i.test(request.url())) requests.push(request.url()); });
    await page.addInitScript(() => { window.__exportAttack = 0; });
    await page.goto(pathToFileURL(filename).href, { waitUntil: 'load' });
    await page.waitForSelector('#learning-content[data-rendered="true"]');
    await page.evaluate(() => document.fonts.ready);
    assert.match(await page.locator('#learning-content h2').innerText(), /Unicode 教学笔记 Ω 😀/);
    assert.equal(await page.locator('#learning-content strong').first().innerText(), '已保存讲解');
    assert.ok(await page.locator('#learning-content .katex').count() >= 2);
    assert.equal(await page.locator('#learning-content table').count(), 1);
    assert.equal(await page.evaluate(() => window.__exportAttack), 0);
    assert.equal(await page.locator('#learning-content script,#learning-content img,#learning-content iframe,#learning-content form,#learning-content svg,#learning-content audio,#learning-content style,#learning-content [onerror],#learning-content [onload]').count(), 0);
    assert.equal(await page.locator('#learning-content a[href^="javascript:"]').count(), 0);
    assert.equal(await page.locator('#learning-content a[href="https://example.invalid/source"]').count(), 1);
    assert.equal(await page.locator('#learning-content a[href*="evil.invalid"]').count(), 0);
    assert.equal(await page.locator('script[src],link[href],iframe').count(), 0);
    assert.ok(await page.evaluate(() => [...document.fonts].some(font => font.status === 'loaded')));
    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await page.locator('#print-learning').click();
    assert.equal(await page.evaluate(() => window.__printed), 1);
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 1000);
    await writeFile(path.join(evidence, 'export-browser.pdf'), pdf);
    await page.screenshot({ path: path.join(evidence, 'export-browser.png'), fullPage: true });
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
    const noJs = await browser.newContext({ javaScriptEnabled: false, offline: true });
    const plain = await noJs.newPage();
    await plain.goto(pathToFileURL(filename).href);
    assert.equal(await plain.locator('noscript pre').textContent(), body);
    assert.equal(await plain.locator('noscript script,noscript img').count(), 0);
    await writeFile(budgetFile, await renderOfflineLearningHtml({ content: '$x$ '.repeat(501) }));
    await page.goto(pathToFileURL(budgetFile).href);
    await page.waitForSelector('#learning-content[data-rendered="true"]');
    assert.match(await page.locator('#render-status').textContent(), /500/);
    assert.equal(await page.locator('#learning-content .katex').count(), 0);
    await writeFile(path.join(evidence, 'export-browser.json'), JSON.stringify({ scope: 'synthetic persisted Markdown, file://, offline browser, no model', passed: true, networkRequests: requests, browserErrors: errors, pdfBytes: pdf.length, htmlBytes: Buffer.byteLength(html), noJs: true, mathBudget: 500, chrome }, null, 2));
  } finally {
    if (browser) await browser.close();
    const absolute = path.resolve(temp);
    assert.equal(path.dirname(absolute).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(absolute).startsWith('study-export-'));
    await rm(absolute, { recursive: true, force: true });
  }
});
