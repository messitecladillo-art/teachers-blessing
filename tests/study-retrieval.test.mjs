import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveMaterialSources, RETRIEVAL_LIMITS } from '../learning/retrieval.mjs';

const record = (id, text, extra = {}) => ({ id, collection: 'materials', updatedAt: '2026-11-16T00:00:00Z', text, ...extra });

test('finds a distinctive keyword near the file end rather than returning its first 2000 characters', () => {
  const text = '普通背景文字。'.repeat(1800) + '\n结论：heliotropeprotocol 是本实验末尾的独特标志。';
  const result = retrieveMaterialSources([record('late', text)], 'What is heliotropeprotocol?');
  assert.equal(result.length, 1);
  assert.match(result[0].text, /heliotropeprotocol/);
  assert.equal(result[0].retrieval.fallback, false);
  assert.equal(result[0].retrieval.scannedChars, text.length);
  assert.ok(result[0].retrieval.excerpts.some(part => part.start > 2000));
  assert.equal(result[0].retrieval.coverage, 'partial');
});

test('segments Chinese questions and keeps actual page labels instead of array indexes', () => {
  const result = retrieveMaterialSources([{ id: 'pdf', collection: 'fileRecords', updatedAt: 'v1', text: '不应重复检索的全文', pages: [
    { number: 7, text: '这是背景章节。' },
    { number: 42, text: '光合作用将光能转化为化学能，蒸腾作用与水分运输相关。' },
    { number: '附录乙', text: '光合作用实验需要控制光照条件。' },
  ] }], '请解释光合作用');
  assert.equal(result[0].retrieval.fallback, false);
  assert.ok(result[0].retrieval.matchedTerms.includes('光合作用'));
  assert.deepEqual(result[0].sourcePages, [42, '附录乙']);
  assert.doesNotMatch(result[0].text, /不应重复检索/);
  assert.ok(result[0].retrieval.excerpts.every(part => part.page === 42 || part.page === '附录乙'));
});

test('keeps identically named files distinct by collection and ID and aggregates same-source pages', () => {
  const result = retrieveMaterialSources([
    record('a', 'orionmarker 第一文件', { name: '相同.md' }),
    record('b', 'orionmarker 第二文件', { name: '相同.md' }),
    record('a', 'orionmarker 另一集合', { collection: 'fileRecords' }),
    { id: 'pages', collection: 'fileRecords', pages: [{ number: 12, text: 'orionmarker 甲' }, { number: 19, text: 'orionmarker 乙' }] },
  ], 'orionmarker');
  assert.equal(result.length, 4);
  assert.deepEqual(result.map(item => [item.collection, item.id]), [['materials', 'a'], ['materials', 'b'], ['fileRecords', 'a'], ['fileRecords', 'pages']]);
  assert.deepEqual(result.find(item => item.id === 'pages').sourcePages, [12, 19]);
});

test('enforces total, per-source and source-count budgets including omission markers', () => {
  const input = Array.from({ length: 15 }, (_, index) => record(`id-${index}`, ('budgetmarker-' + 'x'.repeat(80) + '\n').repeat(100)));
  const result = retrieveMaterialSources(input, 'budgetmarker', { maxTotalChars: 450, maxPerSourceChars: 160, maxSources: 3 });
  assert.ok(result.length <= 3);
  assert.ok(result.reduce((sum, item) => sum + item.text.length, 0) <= 450);
  for (const item of result) { assert.ok(item.text.length <= 160); assert.match(item.text, /budgetmarker/); }
  assert.ok(result.every(item => item.retrieval.outputTruncated));
});

test('tiny excerpt focuses on a late match and offsets reproduce literal source substrings', () => {
  const text = 'z'.repeat(760) + ' distinctivefocus ' + 'z'.repeat(600);
  const result = retrieveMaterialSources([record('crop', text)], 'distinctivefocus', { maxPerSourceChars: 80 });
  assert.match(result[0].text, /distinctivefocus/);
  assert.ok(result[0].text.length <= 80);
  const part = result[0].retrieval.excerpts[0];
  assert.equal(result[0].text, text.slice(part.start, part.end));
});

test('no-hit and empty/stopword queries truthfully return limited overview fallback', () => {
  const input = [record('overview', '开头的材料概要。' + '正文。'.repeat(1200))];
  for (const query of ['unfindablemark', '', '请问这个材料是什么呢']) {
    const [result] = retrieveMaterialSources(input, query);
    assert.equal(result.retrieval.fallback, true);
    assert.equal(result.retrieval.method, 'keyword');
    assert.equal(result.retrieval.coverage, 'partial');
    assert.equal(result.retrieval.outputTruncated, true);
    assert.deepEqual(result.retrieval.matchedTerms, []);
    assert.ok(result.text.length <= 1000);
    assert.match(result.retrieval.fallbackReason, /no-keyword-match|no-searchable-query/);
  }
});

test('scan is hard-bounded, fairly includes another file, and reports unscanned text', () => {
  const huge = '无关背景。'.repeat(Math.ceil((RETRIEVAL_LIMITS.scanChars + 1000) / 5)) + 'beyondscanmarker';
  const result = retrieveMaterialSources([record('huge', huge), record('small', 'smallfilemarker')], 'beyondscanmarker smallfilemarker');
  assert.equal(result[0].id, 'small');
  assert.equal(result[0].retrieval.request.scanTruncated, true);
  assert.ok(result[0].retrieval.request.scannedChars <= RETRIEVAL_LIMITS.scanChars);
  const [fallback] = retrieveMaterialSources([record('huge', huge)], 'beyondscanmarker');
  assert.equal(fallback.retrieval.fallback, true);
  assert.equal(fallback.retrieval.scanTruncated, true);
  assert.equal(fallback.retrieval.scannedChars, RETRIEVAL_LIMITS.scanChars);
  assert.ok(fallback.retrieval.sourceChars > fallback.retrieval.scannedChars);
});

test('record and page metadata budgets are explicit and query term count stays bounded', () => {
  const input = Array.from({ length: 260 }, (_, index) => record(`r${index}`, 'overview'));
  const [result] = retrieveMaterialSources(input, Array.from({ length: 40 }, (_, index) => `termmarker${index}`).join(' '));
  assert.equal(result.retrieval.request.omittedRecords, 4);
  assert.equal(result.retrieval.request.scanTruncated, true);
  assert.equal(result.retrieval.queryTerms.length, 32);
  assert.equal(result.retrieval.queryTermsTruncated, true);
  const [pages] = retrieveMaterialSources([{ id: 'many-pages', pages: Array.from({ length: 501 }, (_, number) => ({ number: number + 10, text: 'overview' })) }], 'absentkeyword');
  assert.equal(pages.retrieval.sourceCharsKnown, false);
  assert.equal(pages.retrieval.scanTruncated, true);
  assert.equal(pages.retrieval.coverage, 'partial');
});

test('stable ordering is reproducible, inputs are unmodified, and source text stays literal data', () => {
  const input = [record('b', 'stablesignal <script>alert(1)</script>'), record('a', 'stablesignal <script>alert(1)</script>')];
  const before = structuredClone(input);
  const first = retrieveMaterialSources(input, 'stablesignal');
  assert.deepEqual(first, retrieveMaterialSources(input, 'stablesignal'));
  assert.deepEqual(first.map(item => item.id), ['b', 'a']);
  assert.match(first[0].text, /<script>alert\(1\)<\/script>/);
  assert.deepEqual(input, before);
  assert.equal(first[0].retrieval.coverage, 'full');
});

test('rejects invalid requests with bounded public errors and handles no material', () => {
  for (const [run, code] of [
    [() => retrieveMaterialSources({}, 'x'), 'RETRIEVAL_INVALID_RECORDS'],
    [() => retrieveMaterialSources([], null), 'RETRIEVAL_INVALID_QUERY'],
    [() => retrieveMaterialSources([], 'x'.repeat(6001)), 'RETRIEVAL_QUERY_TOO_LONG'],
    [() => retrieveMaterialSources([], 'x', { maxSources: 11 }), 'RETRIEVAL_INVALID_OPTIONS'],
    [() => retrieveMaterialSources([], 'x', { maxTotalChars: Infinity }), 'RETRIEVAL_INVALID_OPTIONS'],
  ]) assert.throws(run, error => error.status === 400 && error.code === code);
  assert.deepEqual(retrieveMaterialSources([], 'x'), []);
  assert.doesNotThrow(() => retrieveMaterialSources([], 'x'.repeat(6000)));
});
