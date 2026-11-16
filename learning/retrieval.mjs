/** Bounded, deterministic keyword retrieval. Callers must authorize records first. */
export const RETRIEVAL_LIMITS = Object.freeze({
  queryChars: 6000, totalChars: 20000, perSourceChars: 6000, sources: 10,
  scanChars: 4000000, records: 256, pagesPerRecord: 500, queryTerms: 32,
});

const CHUNK = 1000;
const OVERLAP = 160;
const CANDIDATES = 16;
const GAP = '\n\n[…省略未选中的原文…]\n\n';
const STOP = new Set(('a an and are as at be by can do does for from how i in is it of on or that the this to was what when where which who why with you your ' +
  '的 地 得 了 与 和 及 或 在 是 有 中 第 页 请 请问 说明 解释 回答 告诉 什么 怎么 怎样 如何 为何 为什么 是否 可以 关于 根据 材料 教材 文件 内容 这个 这 那 一个 一下 哪些 哪 吗 呢 关系 详细').split(' '));
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh-CN', { granularity: 'word' }) : null;
const normalized = value => value.normalize('NFKC').toLowerCase();

function invalid(code, message) {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

function optionsOf(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw invalid('RETRIEVAL_INVALID_OPTIONS', '检索选项必须是对象。');
  const result = {};
  for (const [name, fallback, maximum] of [
    ['maxTotalChars', 20000, 20000], ['maxPerSourceChars', 6000, 6000], ['maxSources', 10, 10],
  ]) {
    const value = options[name] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw invalid('RETRIEVAL_INVALID_OPTIONS', `${name} 必须是 1–${maximum} 的整数。`);
    result[name] = value;
  }
  return result;
}

function queryTerms(query) {
  const text = normalized(query);
  const words = segmenter ? Array.from(segmenter.segment(text), item => item.isWordLike ? item.segment : '') : (text.match(/[\p{L}\p{N}]+/gu) || []);
  const all = [...new Set(words.filter(word => word && /[\p{L}\p{N}]/u.test(word) && !STOP.has(word)))];
  const eligible = all.filter(word => word.length <= 128);
  return { terms: eligible.slice(0, RETRIEVAL_LIMITS.queryTerms), truncated: eligible.length > RETRIEVAL_LIMITS.queryTerms || eligible.length !== all.length };
}

function scoreText(text, terms) {
  const body = normalized(text);
  const matched = [];
  let score = 0;
  let firstMatch = -1;
  for (const term of terms) {
    let offset = body.indexOf(term);
    if (offset < 0) continue;
    matched.push(term);
    if (firstMatch < 0 || offset < firstMatch) firstMatch = offset;
    let count = 0;
    while (offset >= 0 && count < 3) { count++; offset = body.indexOf(term, offset + term.length); }
    score += 100 + count * Math.min(12, term.length);
  }
  return { score, matched, firstMatch };
}

function sourceMetadata(row) {
  const metadata = {};
  for (const name of ['title','textbookId','textbookTitle','chapterId']) if (typeof row[name] === 'string' && row[name].length <= 200) metadata[name] = row[name];
  for (const name of ['revision','textbookRevision','outlineRevision']) if (Number.isSafeInteger(row[name]) && row[name] >= 0) metadata[name] = row[name];
  if (row.sourceAnchor && typeof row.sourceAnchor === 'object' && !Array.isArray(row.sourceAnchor)) {
    const anchor = {};
    for (const name of ['fileId','sha256']) if (typeof row.sourceAnchor[name] === 'string' && row.sourceAnchor[name].length <= 200) anchor[name] = row.sourceAnchor[name];
    for (const name of ['startPage','endPage','startOffset','endOffset']) if (Number.isSafeInteger(row.sourceAnchor[name]) && row.sourceAnchor[name] >= 0) anchor[name] = row.sourceAnchor[name];
    metadata.sourceAnchor = anchor;
  }
  if (row.collection === 'knowledgePoints' && metadata.textbookId && metadata.revision !== undefined) metadata.citation = {
    kind: 'textbook-knowledge', textbookId: metadata.textbookId, knowledgePointId: row.id,
    ...(metadata.textbookTitle ? { textbookTitle: metadata.textbookTitle } : {}), ...(metadata.title ? { title: metadata.title } : {}),
    revision: metadata.revision, ...(metadata.sourceAnchor ? { sourceAnchor: { ...metadata.sourceAnchor } } : {}),
    pagePrecision: 'source-range',
  };
  return metadata;
}

function sourcesOf(records) {
  const sources = [];
  const seen = new Set();
  let skipped = 0;
  for (let index = 0; index < Math.min(records.length, RETRIEVAL_LIMITS.records); index++) {
    const row = records[index];
    if (!row || typeof row.id !== 'string' || !row.id || row.id.length > 200) { skipped++; continue; }
    const collection = typeof row.collection === 'string' ? row.collection : null;
    const key = JSON.stringify([collection, row.id]);
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const hasPages = Array.isArray(row.pages) && row.pages.length > 0;
    const pages = hasPages ? row.pages.slice(0, RETRIEVAL_LIMITS.pagesPerRecord) : null;
    const segments = hasPages ? pages.map((page, segment) => ({
      segment, text: typeof page?.text === 'string' ? page.text : '',
      page: (typeof page?.number === 'number' && Number.isFinite(page.number)) || (typeof page?.number === 'string' && page.number.length <= 80) ? page.number : null,
    })) : [{ segment: 0, page: null, text: typeof row.text === 'string' ? row.text : typeof row.content === 'string' ? row.content : '' }];
    const sourceChars = segments.reduce((total, part) => total + part.text.length, 0);
    if (!sourceChars) { skipped++; continue; }
    sources.push({ id: row.id, collection, updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null, metadata: sourceMetadata(row), index, segments, sourceChars,
      sourceCharsKnown: !hasPages || row.pages.length <= RETRIEVAL_LIMITS.pagesPerRecord,
      originalPages: hasPages ? row.pages.length : 0, scannedChars: 0, candidates: [], overview: null });
  }
  return { sources, skipped, omitted: Math.max(0, records.length - RETRIEVAL_LIMITS.records) };
}

// Water-fill scan budgets so one large first file cannot consume every other file's scan.
function scanAllocations(sources) {
  const budgets = sources.map(() => 0);
  let active = sources.map((_, index) => index);
  let remaining = RETRIEVAL_LIMITS.scanChars;
  while (active.length && remaining > 0) {
    const share = Math.floor(remaining / active.length);
    const small = active.filter(index => sources[index].sourceChars <= share);
    if (small.length) {
      for (const index of small) { budgets[index] = sources[index].sourceChars; remaining -= budgets[index]; }
      const complete = new Set(small);
      active = active.filter(index => !complete.has(index));
    } else {
      for (const index of active) { budgets[index] = share + (remaining % active.length > active.indexOf(index) ? 1 : 0); }
      break;
    }
  }
  return budgets;
}

const candidateOrder = (a, b) => b.score - a.score || a.segment - b.segment || a.start - b.start;
function scan(source, budget, terms) {
  let remaining = budget;
  for (const part of source.segments) {
    const length = Math.min(part.text.length, remaining);
    if (!length) continue;
    source.scannedChars += length;
    remaining -= length;
    if (!source.overview) source.overview = { segment: part.segment, start: 0, end: Math.min(length, CHUNK), score: 0, firstMatch: 0 };
    if (terms.length) {
      for (let start = 0; start < length; start += CHUNK - OVERLAP) {
        const end = Math.min(length, start + CHUNK);
        const result = scoreText(part.text.slice(start, end), terms);
        if (result.score) {
          source.candidates.push({ segment: part.segment, start, end, score: result.score, firstMatch: result.firstMatch });
          source.candidates.sort(candidateOrder);
          if (source.candidates.length > CANDIDATES) source.candidates.length = CANDIDATES;
        }
        if (end === length) break;
      }
    }
    if (!remaining) break;
  }
  const matched = new Set();
  for (const candidate of source.candidates) for (const term of scoreText(source.segments[candidate.segment].text.slice(candidate.start, candidate.end), terms).matched) matched.add(term);
  source.score = matched.size * 10000 + (source.candidates[0]?.score || 0);
}

function merged(ranges) {
  const result = [];
  for (const range of [...ranges].sort((a, b) => a.segment - b.segment || a.start - b.start)) {
    const previous = result.at(-1);
    if (previous && previous.segment === range.segment && previous.end >= range.start) previous.end = Math.max(previous.end, range.end);
    else result.push({ segment: range.segment, start: range.start, end: range.end });
  }
  return result;
}
const rangeChars = ranges => ranges.reduce((sum, range) => sum + range.end - range.start, 0) + Math.max(0, ranges.length - 1) * GAP.length;

function excerpts(source, candidates, budget, terms) {
  let ranges = [];
  for (const candidate of candidates) {
    let proposed = merged([...ranges, candidate]);
    if (rangeChars(proposed) <= budget) { ranges = proposed; continue; }
    const available = budget - rangeChars(ranges) - (ranges.length ? GAP.length : 0);
    if (available < 1) continue;
    // Retain the match when a caller requests a very small excerpt budget.
    const focus = candidate.start + Math.max(0, candidate.firstMatch);
    const start = Math.max(candidate.start, Math.min(candidate.end - available, focus - Math.floor(available / 3)));
    proposed = merged([...ranges, { segment: candidate.segment, start, end: Math.min(candidate.end, start + available) }]);
    if (rangeChars(proposed) <= budget) ranges = proposed;
  }
  const pages = [];
  const details = [];
  const texts = [];
  const matched = new Set();
  for (const range of ranges) {
    const part = source.segments[range.segment];
    const text = part.text.slice(range.start, range.end);
    const score = scoreText(text, terms);
    for (const term of score.matched) matched.add(term);
    if (part.page !== null && !pages.includes(part.page)) pages.push(part.page);
    texts.push(text);
    details.push({ page: part.page, start: range.start, end: range.end, matchedTerms: score.matched });
  }
  return { text: texts.join(GAP), pages, details, matched: [...matched], returnedChars: ranges.reduce((sum, range) => sum + range.end - range.start, 0) };
}

/** No authorization, model call, network, filesystem, or execution occurs here. */
export function retrieveMaterialSources(records, query, options = {}) {
  if (!Array.isArray(records)) throw invalid('RETRIEVAL_INVALID_RECORDS', '检索材料必须是数组。');
  if (typeof query !== 'string') throw invalid('RETRIEVAL_INVALID_QUERY', '检索问题必须是字符串。');
  if (query.length > RETRIEVAL_LIMITS.queryChars) throw invalid('RETRIEVAL_QUERY_TOO_LONG', '检索问题不得超过 6000 字符。');
  const limits = optionsOf(options);
  const tokenized = queryTerms(query);
  const { sources, skipped, omitted } = sourcesOf(records);
  const budgets = scanAllocations(sources);
  for (let index = 0; index < sources.length; index++) scan(sources[index], budgets[index], tokenized.terms);
  const matches = sources.filter(source => source.candidates.length).sort((a, b) => b.score - a.score || a.index - b.index);
  const fallback = matches.length === 0;
  const ranked = (fallback ? sources.filter(source => source.overview) : matches).slice(0, limits.maxSources);
  const request = {
    inputRecords: records.length, consideredRecords: sources.length, skippedRecords: skipped, omittedRecords: omitted,
    scannedChars: sources.reduce((sum, source) => sum + source.scannedChars, 0), scanBudgetChars: RETRIEVAL_LIMITS.scanChars,
    scanTruncated: omitted > 0 || sources.some(source => !source.sourceCharsKnown || source.scannedChars < source.sourceChars),
    matchingSources: matches.length, omittedMatchingSources: Math.max(0, matches.length - limits.maxSources),
  };
  const results = [];
  let remaining = limits.maxTotalChars;
  for (const source of ranked) {
    if (remaining < 1) break;
    const excerpt = excerpts(source, fallback ? [source.overview] : source.candidates, Math.min(remaining, limits.maxPerSourceChars), tokenized.terms);
    if (!excerpt.text) continue;
    remaining -= excerpt.text.length;
    const full = source.sourceCharsKnown && excerpt.returnedChars === source.sourceChars;
    results.push({ id: source.id, collection: source.collection, updatedAt: source.updatedAt, ...source.metadata, text: excerpt.text, sourcePages: excerpt.pages,
      retrieval: {
        method: 'keyword', fallback, fallbackReason: fallback ? (tokenized.terms.length ? 'no-keyword-match-in-scanned-text' : 'no-searchable-query-terms') : null,
        queryTerms: tokenized.terms, queryTermsTruncated: tokenized.truncated, matchedTerms: excerpt.matched, score: fallback ? 0 : source.score,
        sourceChars: source.sourceChars, sourceCharsKnown: source.sourceCharsKnown, scannedChars: source.scannedChars,
        scanTruncated: !source.sourceCharsKnown || source.scannedChars < source.sourceChars,
        returnedSourceChars: excerpt.returnedChars, coverage: full ? 'full' : 'partial', outputTruncated: !full,
        excerpts: excerpt.details, limits: { ...limits }, request,
      } });
  }
  request.returnedSources = results.length;
  request.omittedSources = Math.max(0, (fallback ? sources.filter(source => source.overview).length : matches.length) - results.length);
  request.omittedMatchingSources = fallback ? 0 : Math.max(0, matches.length - results.length);
  request.outputTruncated = request.omittedSources > 0 || results.some(source => source.retrieval.outputTruncated);
  return results;
}
