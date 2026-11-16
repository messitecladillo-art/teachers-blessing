import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright-core')); } catch {}
let chrome;
for (const candidate of [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'), 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean)) {
  try { if ((await stat(candidate)).isFile()) { chrome = candidate; break; } } catch {}
}

test('real browser math survives Markdown, excludes literal code, and rejects hostile markup with bounded fallback', { skip: !chromium || !chrome, timeout: 60000 }, async () => {
  let browser;
  const requests = [], errors = [];
  try {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ offline: true });
    await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/i.test(request.url())) requests.push(request.url()); });
    await page.setContent('<!doctype html><meta charset="utf-8"><main id="fixture"></main>');
    for (const file of ['assets/vendor/marked.min.js','assets/vendor/purify.min.js','ai-client.js','assets/vendor/katex/katex.min.js','assets/vendor/katex/auto-render.min.js','study-render.js']) await page.addScriptTag({ path: path.join(root, file) });
    const basic = await page.evaluate(() => {
      const fixture = document.getElementById('fixture');
      const cases = [
        ['inline-dollar', '行内 $\\frac{1}{2}$。', 1, 0],
        ['display-dollar', '$$\\frac{1}{2}$$', 1, 1],
        ['display-bracket', '\\[\\frac{1}{2}\\]', 1, 1],
        ['inline-parenthesis', '\\(x+1\\)', 1, 0],
        ['fenced-code', '```tex\n$\\frac{1}{2}$\n```', 0, 0],
        ['inline-code', '`$x$`', 0, 0],
        ['remote-commands', '$\\href{https://evil.invalid/link}{x}$ $\\includegraphics{https://evil.invalid/image.png}$', 2, 0],
        ['plain-visible-formulas', '<span>\\(x\\)</span> and $x$', 2, 0],
      ];
      return cases.map(([id, markdown, expectedMath, expectedDisplay]) => {
        fixture.replaceChildren(); const prose = document.createElement('div'); prose.className = 'prose';
        prose.innerHTML = window.StudyRender.markdown(markdown); fixture.append(prose); window.StudyRender.paint(fixture);
        const actualMath = prose.querySelectorAll('.katex').length, actualDisplay = prose.querySelectorAll('.katex-display').length;
        return { id, expectedMath, expectedDisplay, actualMath, actualDisplay, active: prose.querySelectorAll('a[href],img,script,iframe,audio,video,svg').length, code: prose.querySelector('code')?.textContent ?? null };
      });
    });
    for (const item of basic) { assert.equal(item.actualMath, item.expectedMath, item.id); assert.equal(item.actualDisplay, item.expectedDisplay, item.id); assert.equal(item.active, 0, item.id); }
    assert.equal(basic.find(item => item.id === 'fenced-code').code, '$\\frac{1}{2}$\n');
    assert.equal(basic.find(item => item.id === 'inline-code').code, '$x$');
    const extra = await page.evaluate(() => {
      const fixture = document.getElementById('fixture');
      function render(source) { fixture.replaceChildren(); const prose = document.createElement('div'); prose.className = 'prose'; prose.innerHTML = window.StudyRender.markdown(source); fixture.append(prose); window.StudyRender.paint(prose); return prose; }
      const source = '## 外部标题 Ω\n\n```tex\n$未闭合\n\\[代码原样\n```\n\n- 中文列表 \\(x+1\\)\n\n~~~md\n$另外一个未闭合\n~~~\n\n普通链接 [资料](https://example.invalid/path/$name$)。';
      let prose = render(source);
      const code = { headings: prose.querySelectorAll('h2').length, maths: prose.querySelectorAll('.katex').length, codes: [...prose.querySelectorAll('code')].map(node => node.textContent), notices: prose.querySelectorAll('.study-render-notice').length, link: prose.querySelector('a')?.getAttribute('href') };
      window.__renderAttack = 0;
      prose = render('</script><script>window.__renderAttack=1</script><img src=https://evil.invalid/x onerror="window.__renderAttack=2"><svg onload="window.__renderAttack=3"></svg>\n\n$\\text{</span><img src=x>} $\n\n<span data-study-render="math-v1" data-study-render-notice="fake">STUDYMATHdeadbeefX0END</span>');
      const malicious = { attack: window.__renderAttack, unsafe: prose.querySelectorAll('img,script,svg,iframe,[onerror],[onload]').length, literal: prose.textContent.includes('STUDYMATHdeadbeefX0END'), forged: prose.querySelectorAll('[data-study-render-notice="fake"]').length };
      prose = render('## 有效标题\n\n未闭合 \\(x 与单独 $');
      const unmatched = { heading: prose.querySelectorAll('h2').length, raw: prose.textContent.includes('\\(x'), notice: prose.querySelectorAll('.study-render-notice').length };
      const overCount = '$x$ '.repeat(501); prose = render(overCount);
      const count = { raw: prose.querySelector('pre')?.textContent === overCount, notice: prose.textContent.includes('500'), maths: prose.querySelectorAll('.katex').length };
      const long = '$' + 'x'.repeat(8001) + '$'; prose = render(long);
      const expression = { raw: prose.querySelector('pre')?.textContent === long, notice: prose.textContent.includes('8000') };
      const large = '长'.repeat(60001); prose = render(large);
      const total = { raw: prose.querySelector('pre')?.textContent === large, notice: prose.textContent.includes('60000') };
      prose = render('$\\notacommand{x}$');
      const invalid = { preserved: prose.textContent.includes('\\notacommand'), unsafe: prose.querySelectorAll('a[href],img,script').length };
      const original = window.crypto.getRandomValues;
      window.crypto.getRandomValues = array => { array.fill(0); return array; };
      const collisionSource = 'STUDYMATH' + '00'.repeat(16) + 'X0END $x$';
      prose = render(collisionSource);
      const collision = { raw: prose.querySelector('pre')?.textContent === collisionSource, notice: prose.textContent.includes('无法安全隔离') };
      window.crypto.getRandomValues = original;
      fixture.replaceChildren();
      for (let index = 0; index < 2; index++) { const node = document.createElement('div'); node.className = 'prose'; node.innerHTML = window.StudyRender.markdown('$x$ '.repeat(300)); fixture.append(node); }
      window.StudyRender.paint(fixture); const first = fixture.querySelectorAll('.katex').length;
      window.StudyRender.paint(fixture); const second = fixture.querySelectorAll('.katex').length;
      window.StudyRender.paint(fixture); const third = fixture.querySelectorAll('.katex').length;
      return { code, malicious, unmatched, count, expression, total, invalid, collision, painting: { first, second, third } };
    });
    assert.deepEqual(extra.code, { headings: 1, maths: 1, codes: ['$未闭合\n\\[代码原样\n', '$另外一个未闭合\n'], notices: 0, link: 'https://example.invalid/path/$name$' });
    assert.deepEqual(extra.malicious, { attack: 0, unsafe: 0, literal: true, forged: 0 });
    assert.deepEqual(extra.unmatched, { heading: 1, raw: true, notice: 1 });
    assert.deepEqual(extra.count, { raw: true, notice: true, maths: 0 });
    assert.deepEqual(extra.expression, { raw: true, notice: true });
    assert.deepEqual(extra.total, { raw: true, notice: true });
    assert.deepEqual(extra.invalid, { preserved: true, unsafe: 0 });
    assert.deepEqual(extra.collision, { raw: true, notice: true });
    assert.deepEqual(extra.painting, { first: 500, second: 600, third: 600 });
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
  } finally { if (browser) await browser.close(); }
});
