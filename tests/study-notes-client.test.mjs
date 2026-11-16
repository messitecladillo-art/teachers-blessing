import test from 'node:test';
import assert from 'node:assert/strict';
import { stat, mkdir, writeFile } from 'node:fs/promises';
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

test('real DOM captures all note kinds, repeated occurrences, safe quotes, stale contexts and strict relocation', { skip: !chromium || !chrome, timeout: 60000 }, async () => {
  const checks = []; const errors = []; let browser;
  const evidence = path.join(root, '.collab/mentrix/evidence'); await mkdir(evidence, { recursive: true });
  try {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, offline: true });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body><main id="fixture"></main></body></html>');
    await page.evaluate(() => {
      window.ctx = { userId: 'synthetic-a', epoch: 1, kp: { id: 'kp-a', revision: 3 }, lesson: { id: 'lesson-a', sourceRevision: 3, version: 2 }, exercise: { id: 'set-a', sourceRevision: 3 }, attempt: { id: 'attempt-a', gradingVersion: 4, gradingJobId: 'grade-a', grading: { gradedAt: 'synthetic-time' } }, conversation: { id: 'conversation-a' } };
      window.requests = []; window.notifications = []; window.__quoteXSS = 0;
      const fixture = document.getElementById('fixture');
      const add = (text, props) => { const node = document.createElement('div'); node.style.margin = '20px'; node.textContent = text; Object.assign(node, props); fixture.append(node); return node; };
      add('前文 重复句。 中间 重复句。 后文', { id: 'source-prose', className: 'prose' });
      add('讲解：<img src=x onerror="window.__quoteXSS=1"> <script>window.__quoteXSS=2</script>。', { id: 'lesson-prose', className: 'prose' });
      for (const id of ['message-a', 'message-b']) { const node = add('追问 重复词 与 重复词 结束', { className: 'prose' }); node.dataset.messageId = id; }
      for (const block of ['stem', 'reference_answer', 'solution', 'feedback']) {
        const node = add(block + '：相同文本 以及 相同文本。', { className: 'prose' });
        Object.assign(node.dataset, { noteKind: 'exercise', noteSource: 'set-a', noteRevision: '3', questionId: 'question-a', noteBlock: block });
        if (block !== 'stem') node.dataset.attemptId = 'attempt-a';
      }
      window.testApi = async (url, options) => {
        window.requests.push({ url, ...options });
        if (window.deferRequest) return new Promise(resolve => { window.resolveRequest = resolve; });
        return { ...options.data, id: 'note-' + window.requests.length, userId: window.ctx.userId, resolution: { status: 'resolved', requiresReview: !!window.reviewReply } };
      };
    });
    await page.addScriptTag({ path: path.join(root, 'study-notes.js') });
    await page.evaluate(() => { window.notes = window.StudyNotes.install({ getContext: () => window.ctx, api: window.testApi, notify: (message, error) => window.notifications.push({ message, error }) }); });
    async function select(selector, exact, occurrence = 0) {
      await page.evaluate(({ selector, exact, occurrence }) => {
        const root = document.querySelector(selector); const text = root.textContent;
        let start = -1; for (let index = 0; index <= occurrence; index++) start = text.indexOf(exact, start + 1);
        if (start < 0) throw new Error('Synthetic selection missing');
        const end = start + exact.length; const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node; let offset = 0; let first; let last;
        while ((node = walker.nextNode())) { const length = node.textContent.length; if (!first && start >= offset && start < offset + length) first = [node, start - offset]; if (end > offset && end <= offset + length) { last = [node, end - offset]; break; } offset += length; }
        const range = document.createRange(); range.setStart(...first); range.setEnd(...last);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      }, { selector, exact, occurrence });
      await page.locator('[data-study-notes-toolbar]').waitFor();
    }
    async function save(selector, exact, occurrence = 0, color = 'yellow') {
      const before = await page.evaluate(() => window.requests.length);
      await select(selector, exact, occurrence); await page.locator('[data-study-notes-toolbar]').click();
      await page.locator('#study-notes-form textarea').fill('合成个人笔记'); await page.locator('#study-notes-form select').selectOption(color);
      await page.locator('#study-notes-form button[type=submit]').click();
      await page.waitForFunction(count => window.requests.length === count + 1 && !document.getElementById('study-notes-dialog').open, before);
      return page.evaluate(() => window.requests.at(-1).data);
    }
    const source = await save('#source-prose', '重复句。', 1, 'green');
    assert.equal(source.sourceKind, 'source'); assert.equal(source.sourceId, 'kp-a'); assert.equal(source.revision, 3); assert.equal(source.occurrence, 1); assert.equal(source.color, 'green');
    assert.equal(source.prefix, '前文 重复句。 中间 '); assert.equal(source.suffix, ' 后文'); checks.push('real Range second occurrence and 32-character context');
    const hostile = '<img src=x onerror="window.__quoteXSS=1">';
    await select('#lesson-prose', hostile); await page.locator('[data-study-notes-toolbar]').click();
    assert.equal(await page.locator('#study-notes-quote').textContent(), hostile); assert.equal(await page.locator('#study-notes-dialog img,#study-notes-dialog script').count(), 0);
    await page.locator('#study-notes-form button[type=submit]').click(); await page.waitForFunction(() => !document.getElementById('study-notes-dialog').open);
    const lesson = await page.evaluate(() => window.requests.at(-1).data); assert.equal(lesson.sourceKind, 'lesson'); assert.equal(lesson.lessonId, 'lesson-a'); assert.equal(lesson.revision, 3);
    assert.equal(await page.evaluate(() => window.__quoteXSS), 0); checks.push('lesson version and hostile quote use textContent');
    const conversation = await save('[data-message-id="message-b"]', '重复词', 1); assert.equal(conversation.sourceKind, 'conversation'); assert.equal(conversation.sourceId, 'message-b'); assert.equal(conversation.revision, 1); assert.equal(conversation.occurrence, 1); checks.push('conversation message identity');
    const exerciseNotes = {};
    for (const block of ['stem', 'reference_answer', 'solution', 'feedback']) {
      const value = await save('[data-note-block="' + block + '"]', '相同文本', 1);
      assert.equal(value.sourceKind, 'exercise'); assert.equal(value.sourceId, 'set-a'); assert.equal(value.questionId, 'question-a'); assert.equal(value.block, block); assert.equal(value.revision, 3);
      assert.equal(value.attemptId, block === 'stem' ? undefined : 'attempt-a'); exerciseNotes[block] = value;
    }
    checks.push('exercise stem/revealed answer/solution/feedback carry correct attempt and block');
    const results = await page.evaluate(({ source, lesson, conversation, exerciseNotes }) => {
      const locate = note => window.notes.locate({ userId: 'synthetic-a', resolution: { status: 'resolved' }, ...note }).status;
      const located = locate(source);
      const range = [...CSS.highlights.get('study-note-green')][0];
      const before = range.cloneRange(); before.selectNodeContents(document.getElementById('source-prose')); before.setEnd(range.startContainer, range.startOffset);
      const output = { located, locatedPrefix: before.toString(), review: locate({ ...source, resolution: { status: 'resolved', requiresReview: true } }), stale: locate({ ...source, revision: 2 }), missing: locate({ ...source, exact: '不存在的段落' }), oldLesson: locate({ ...lesson, lessonId: 'older-lesson' }), conversation: locate({ ...conversation, conversationId: 'conversation-a' }), wrongConversation: locate({ ...conversation, conversationId: 'other-conversation' }), exercise: locate(exerciseNotes.stem), wrongAttempt: locate({ ...exerciseNotes.solution, attemptId: 'another-attempt' }), feedback: locate({ ...exerciseNotes.feedback, attemptGradingVersion: 4, gradingJobId: 'grade-a', gradedAt: 'synthetic-time' }), staleFeedback: locate({ ...exerciseNotes.feedback, attemptGradingVersion: 3, gradingJobId: 'grade-a', gradedAt: 'synthetic-time' }), wrongOwner: locate({ ...source, userId: 'synthetic-b' }) };
      return output;
    }, { source, lesson, conversation, exerciseNotes });
    assert.deepEqual(results, { located: 'located', locatedPrefix: '前文 重复句。 中间 ', review: 'needs-review', stale: 'needs-review', missing: 'unresolved', oldLesson: 'not-present', conversation: 'located', wrongConversation: 'not-present', exercise: 'located', wrongAttempt: 'not-present', feedback: 'located', staleFeedback: 'needs-review', wrongOwner: 'not-present' });
    checks.push('strict version/owner/context relocation and no forced review/stale highlight');
    await select('#source-prose', '重复句。', 1); await page.evaluate(() => { window.ctx.epoch++; }); await page.locator('[data-study-notes-toolbar]').click();
    assert.equal(await page.locator('#study-notes-dialog').evaluate(node => node.open), false); assert.equal(await page.locator('#study-notes-quote').textContent(), '');
    await select('#source-prose', '重复句。', 1); await page.locator('[data-study-notes-toolbar]').click();
    await page.evaluate(() => { location.hash = 'synthetic-new-view'; }); await page.waitForFunction(() => !document.getElementById('study-notes-dialog').open);
    assert.equal(await page.locator('#study-notes-quote').textContent(), ''); checks.push('old epoch and hashchange clear selected quote');
    await page.evaluate(() => { window.reviewReply = true; }); await save('#source-prose', '重复句。');
    assert.match(await page.evaluate(() => window.notifications.at(-1).message), /人工核对/);
    await page.evaluate(() => { window.reviewReply = false; window.deferRequest = true; });
    await select('#source-prose', '重复句。'); await page.locator('[data-study-notes-toolbar]').click(); await page.locator('#study-notes-form button[type=submit]').click();
    await page.waitForFunction(() => typeof window.resolveRequest === 'function');
    const notificationCount = await page.evaluate(() => { window.ctx = { userId: 'synthetic-b', epoch: 99 }; window.dispatchEvent(new Event('study-session-ended')); return window.notifications.length; });
    await page.evaluate(() => { window.resolveRequest({ resolution: { status: 'resolved' } }); });
    await page.waitForTimeout(30);
    assert.equal(await page.locator('#study-notes-quote').textContent(), ''); assert.equal(await page.locator('#study-notes-dialog').evaluate(node => node.open), false); assert.equal(await page.evaluate(() => window.notifications.length), notificationCount);
    checks.push('late save after account switch cannot display prior quote or success');
    await page.screenshot({ path: path.join(evidence, 'producer-notes-browser.png'), fullPage: true });
    await page.evaluate(() => { window.notes.dispose(); });
    assert.equal(await page.locator('#study-notes-dialog,[data-study-notes-toolbar]').count(), 0); assert.deepEqual(errors, []);
    await writeFile(path.join(evidence, 'producer-notes-browser.json'), JSON.stringify({ scope: 'synthetic real browser DOM; no account, server, model or network', passed: true, checks, browserErrors: errors }, null, 2));
  } finally { if (browser) await browser.close(); }
});
