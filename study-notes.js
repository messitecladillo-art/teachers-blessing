/* Source-bound selection notes. Source text never becomes markup or selectors. */
(() => {
  'use strict';
  let activeInstallation;
  const COLORS = ['yellow', 'green', 'blue', 'pink'];
  const BLOCKS = ['stem', 'reference_answer', 'solution', 'feedback'];
  const revision = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const textOf = value => typeof value === 'string' ? value : '';
  const stamp = context => JSON.stringify([context.userId, context.epoch, context.kp?.id, context.kp?.revision,
    context.lesson?.id, context.lesson?.version, context.lesson?.sourceRevision, context.exercise?.id, context.exercise?.sourceRevision,
    context.attempt?.id, context.attempt?.gradingVersion, context.attempt?.gradingJobId, context.attempt?.grading?.gradedAt,
    context.conversation?.id]);
  const visible = node => node?.isConnected && !node.closest('[hidden]') && node.getClientRects().length > 0;
  function element(tag, properties = {}, parent) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(properties)) node[key] = value;
    if (parent) parent.appendChild(node);
    return node;
  }
  function matches(text, exact) {
    const positions = []; let index = text.indexOf(exact);
    while (index >= 0) { positions.push(index); index = text.indexOf(exact, index + 1); }
    return positions;
  }
  function contextMatches(text, start, note) {
    return (!note.prefix || text.slice(Math.max(0, start - note.prefix.length), start) === note.prefix) &&
      (!note.suffix || text.slice(start + note.exact.length, start + note.exact.length + note.suffix.length) === note.suffix);
  }
  function textRange(root, start, end) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node; let offset = 0; let first; let last;
    while ((node = walker.nextNode())) {
      const length = node.textContent.length;
      if (!first && start >= offset && start < offset + length) first = [node, start - offset];
      if (end > offset && end <= offset + length) { last = [node, end - offset]; break; }
      offset += length;
    }
    if (!first || !last) return null;
    const range = document.createRange(); range.setStart(...first); range.setEnd(...last); return range;
  }

  function install({ getContext, api, notify = () => {} } = {}) {
    if (typeof getContext !== 'function' || typeof api !== 'function' || typeof notify !== 'function') throw new TypeError('StudyNotes requires getContext, api and notify functions');
    activeInstallation?.dispose();
    let disposed = false; let capture = null; let dialogCapture = null; let toolbar = null; let submitting = false;
    const style = element('style', { textContent: `
.study-notes-toolbar{position:fixed;z-index:150;background:#365b3b;color:white;border:0;border-radius:7px;padding:9px 13px;font:13px/1.4 system-ui;box-shadow:0 5px 20px #20382833;cursor:pointer}.study-notes-dialog{width:min(560px,calc(100vw - 32px));max-height:85vh;overflow:auto;border:1px solid #dce1d5;border-radius:12px;padding:25px;color:#26362b;background:#fff;font:14px/1.8 system-ui}.study-notes-dialog::backdrop{background:#1c302c66}.study-notes-dialog h2{margin-top:0;font-size:20px}.study-notes-dialog blockquote{white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0;padding:12px;border-left:3px solid #aabd9a;background:#f4f6f0;max-height:180px;overflow:auto}.study-notes-dialog label{display:block;margin:14px 0}.study-notes-dialog textarea{display:block;width:100%;min-height:115px;padding:10px;border:1px solid #cbd5c3;border-radius:6px;font:inherit;resize:vertical}.study-notes-dialog select{margin-left:10px;padding:5px;font:inherit}.study-notes-dialog button{padding:8px 14px;font:inherit;border-radius:6px;border:1px solid #cbd5c3;background:#f6f8f2;cursor:pointer}.study-notes-dialog button[type=submit]{background:#365b3b;color:white}.study-notes-actions{display:flex;justify-content:flex-end;gap:10px}.study-notes-help{font-size:12px;color:#687363}::highlight(study-note-yellow){background:#f2d98b;color:inherit}::highlight(study-note-green){background:#c9e8bd;color:inherit}::highlight(study-note-blue){background:#bedcf6;color:inherit}::highlight(study-note-pink){background:#f4c9df;color:inherit}` }, document.head);
    const dialog = element('dialog', { className: 'study-notes-dialog', id: 'study-notes-dialog' }, document.body);
    dialog.dataset.studyNotesDialog = '';
    element('h2', { textContent: '留下此刻的理解' }, dialog);
    const quote = element('blockquote', { id: 'study-notes-quote' }, dialog);
    const form = element('form', { id: 'study-notes-form' }, dialog);
    const noteLabel = element('label', { textContent: '你的笔记（最多 6000 字符）' }, form);
    const noteInput = element('textarea', { name: 'note', maxLength: 6000, rows: 4, placeholder: '用自己的话解释一下…' }, noteLabel);
    const colorLabel = element('label', { textContent: '批注颜色' }, form);
    const colorInput = element('select', { name: 'color', ariaLabel: '批注颜色' }, colorLabel);
    COLORS.forEach((value, index) => element('option', { value, textContent: ['黄色','绿色','蓝色','粉色'][index] }, colorInput));
    element('p', { className: 'study-notes-help', textContent: '批注固定当前来源与版本。公式或富文本无法精确定位时，请核对原文。' }, form);
    const actions = element('div', { className: 'study-notes-actions' }, form);
    const cancel = element('button', { type: 'button', textContent: '取消' }, actions);
    const submit = element('button', { type: 'submit', textContent: '保存批注' }, actions);

    function context() { try { return getContext() || {}; } catch { return {}; } }
    function clearHighlight() { for (const color of COLORS) window.CSS?.highlights?.delete('study-note-' + color); }
    function clearToolbar() { toolbar?.remove(); toolbar = null; }
    function reset() {
      clearToolbar(); capture = null; dialogCapture = null; submitting = false; submit.disabled = false;
      quote.textContent = ''; noteInput.value = ''; colorInput.value = 'yellow';
      if (dialog.open) dialog.close();
    }
    function sessionChanged() { reset(); clearHighlight(); }

    function descriptor(node, current) {
      if (!node?.isConnected || !current.userId) return null;
      const prose = node.closest('#lesson-prose,#source-prose,.prose[data-message-id],[data-note-kind="exercise"][data-note-source]');
      if (!prose || !visible(prose)) return null;
      if (prose.matches('[data-note-kind="exercise"]')) {
        const blockNode = node.closest('[data-note-block]') || prose;
        if (!prose.contains(blockNode)) return null;
        const questionNode = blockNode.closest('[data-question-id]');
        const questionId = blockNode.dataset.questionId || (questionNode && prose.contains(questionNode) ? questionNode.dataset.questionId : null);
        const block = blockNode.dataset.noteBlock;
        const sourceId = prose.dataset.noteSource;
        const sourceRevision = revision(prose.dataset.noteRevision);
        const attemptId = blockNode.dataset.attemptId || prose.dataset.attemptId;
        if (sourceId !== current.exercise?.id || sourceRevision !== revision(current.exercise?.sourceRevision) || !questionId || !BLOCKS.includes(block)) return null;
        if (block !== 'stem' && (!attemptId || attemptId !== current.attempt?.id)) return null;
        return { root: blockNode, fields: { sourceKind: 'exercise', sourceId, revision: sourceRevision, questionId, block, ...(block !== 'stem' ? { attemptId } : {}) } };
      }
      if (prose.matches('.prose[data-message-id]')) {
        if (!current.conversation?.id || !prose.dataset.messageId) return null;
        return { root: prose, fields: { sourceKind: 'conversation', sourceId: prose.dataset.messageId, revision: 1 } };
      }
      const point = current.kp;
      if (!point?.id || point.archived || !revision(point.revision)) return null;
      const isLesson = prose.id === 'lesson-prose';
      if (isLesson && (!current.lesson?.id || current.lesson.stale || current.lesson.sourceRevision !== point.revision)) return null;
      return { root: prose, fields: { sourceKind: isLesson ? 'lesson' : 'source', sourceId: point.id, revision: point.revision, ...(isLesson ? { lessonId: current.lesson.id } : {}) } };
    }
    function fresh(selected) {
      if (!selected || disposed || capture !== selected || !selected.root.isConnected || selected.root.textContent !== selected.fullText) return false;
      const current = context();
      if (stamp(current) !== selected.contextStamp) return false;
      const actual = descriptor(selected.root, current);
      return actual?.root === selected.root && JSON.stringify(actual.fields) === selected.fieldsStamp;
    }
    function openNote() {
      const selected = capture;
      if (!fresh(selected)) { reset(); return; }
      clearToolbar(); quote.textContent = selected.fields.exact; noteInput.value = ''; colorInput.value = 'yellow';
      dialogCapture = selected;
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
      noteInput.focus();
    }
    function mouseup(event) {
      if (disposed || dialog.contains(event.target) || toolbar?.contains(event.target)) return;
      clearToolbar(); capture = null;
      if (dialog.open) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
      const range = selection.getRangeAt(0);
      const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
      const current = context(); const source = descriptor(ancestor, current);
      if (!source || !source.root.contains(range.startContainer) || !source.root.contains(range.endContainer)) return;
      const raw = range.toString();
      if (raw.length > 10000) return;
      const exact = raw.trim();
      if (!exact || exact.length > 2000) return;
      const fullText = source.root.textContent;
      if (fullText.length > 4000000) { notify('来源文本过大，请选择更小的知识点后批注。', true); return; }
      const prefixRange = range.cloneRange(); prefixRange.selectNodeContents(source.root); prefixRange.setEnd(range.startContainer, range.startOffset);
      const start = prefixRange.toString().length + raw.length - raw.trimStart().length;
      if (fullText.slice(start, start + exact.length) !== exact) { notify('选区无法精确对应原文，请避开公式或跨区域选择。', true); return; }
      const occurrence = matches(fullText, exact).indexOf(start);
      if (occurrence < 0) return;
      const fields = { ...source.fields, exact, prefix: fullText.slice(Math.max(0, start - 32), start), suffix: fullText.slice(start + exact.length, start + exact.length + 32), occurrence };
      capture = { root: source.root, fullText, fields, fieldsStamp: JSON.stringify(source.fields), contextStamp: stamp(current) };
      const rect = range.getBoundingClientRect();
      toolbar = element('button', { type: 'button', className: 'study-notes-toolbar', textContent: '＋ 保存批注' }, document.body);
      toolbar.dataset.studyNotesToolbar = '';
      toolbar.style.left = Math.max(8, Math.min(window.innerWidth - 125, rect.left)) + 'px';
      toolbar.style.top = Math.max(8, Math.min(window.innerHeight - 45, rect.top - 44)) + 'px';
      toolbar.addEventListener('mousedown', event => event.preventDefault()); toolbar.addEventListener('click', openNote);
    }

    async function save(event) {
      event.preventDefault(); event.stopPropagation();
      const selected = capture;
      if (submitting) return;
      if (!fresh(selected)) { reset(); return; }
      if (noteInput.value.length > 6000 || !COLORS.includes(colorInput.value)) { notify('笔记最多 6000 字符，请使用列表中的颜色。', true); return; }
      submitting = true; submit.disabled = true;
      try {
        const reply = await api('/highlights', { method: 'POST', data: { ...selected.fields, note: noteInput.value, color: colorInput.value } });
        if (!fresh(selected)) { if (capture === selected) reset(); return; }
        reset();
        if (reply?.requiresReview || reply?.resolution?.requiresReview) notify('批注已保存，原文位置需要人工核对；未自动精确标记。');
        else notify('批注已保存，可在笔记中查看。');
      } catch (error) {
        if (fresh(selected) && error?.code !== 'STALE_VIEW') notify(error?.message || '批注保存失败，请重试。', true);
      } finally {
        if (capture === selected) { submitting = false; submit.disabled = false; }
      }
    }

    function locate(note) {
      clearHighlight();
      const current = context();
      if (disposed || !current.userId || !note || (note.userId && note.userId !== current.userId)) return { status: 'not-present' };
      if (note.requiresReview || note.resolution?.requiresReview || ['stale','ambiguous'].includes(note.resolution?.status)) return { status: 'needs-review' };
      if (note.resolution?.status === 'unresolved') return { status: 'unresolved' };
      const kind = note.sourceKind || 'source'; let root;
      if (kind === 'source' || kind === 'lesson') {
        if (current.kp?.id !== note.sourceId) return { status: 'not-present' };
        if (current.kp.archived || !revision(note.revision) || revision(note.revision) !== revision(current.kp.revision)) return { status: 'needs-review' };
        if (kind === 'lesson') {
          if (current.lesson?.id !== note.lessonId) return { status: 'not-present' };
          if (current.lesson.stale || current.lesson.sourceRevision !== current.kp.revision || (note.lessonVersion !== undefined && note.lessonVersion !== current.lesson.version)) return { status: 'needs-review' };
        }
        root = document.getElementById(kind === 'lesson' ? 'lesson-prose' : 'source-prose');
      } else if (kind === 'conversation') {
        if (!current.conversation?.id || (note.conversationId && note.conversationId !== current.conversation.id)) return { status: 'not-present' };
        if (revision(note.revision) !== 1 || (note.knowledgePointId === current.kp?.id && note.knowledgePointRevision !== undefined && note.knowledgePointRevision !== current.kp.revision)) return { status: 'needs-review' };
        root = [...document.querySelectorAll('.prose[data-message-id]')].find(node => node.dataset.messageId === note.sourceId);
      } else if (kind === 'exercise') {
        if (current.exercise?.id !== note.sourceId) return { status: 'not-present' };
        if (!revision(note.revision) || revision(note.revision) !== revision(current.exercise.sourceRevision)) return { status: 'needs-review' };
        if (!BLOCKS.includes(note.block)) return { status: 'unresolved' };
        if (note.block !== 'stem' && current.attempt?.id !== note.attemptId) return { status: 'not-present' };
        if (note.block === 'feedback' && (note.attemptGradingVersion !== current.attempt?.gradingVersion || (note.gradingJobId ?? null) !== (current.attempt?.gradingJobId ?? null) || (note.gradedAt ?? null) !== (current.attempt?.grading?.gradedAt ?? null))) return { status: 'needs-review' };
        const containers = [...document.querySelectorAll('[data-note-kind="exercise"][data-note-source]')].filter(node => node.dataset.noteSource === note.sourceId);
        for (const container of containers) {
          const blocks = container.hasAttribute('data-note-block') ? [container] : [...container.querySelectorAll('[data-note-block]')];
          root = blocks.find(node => { const source = descriptor(node, current); return source?.fields.questionId === note.questionId && source.fields.block === note.block && (note.block === 'stem' || source.fields.attemptId === note.attemptId); });
          if (root) break;
        }
      } else return { status: 'unresolved' };
      if (!visible(root)) return { status: 'not-present' };
      if (typeof note.exact !== 'string' || !note.exact || note.exact.length > 2000 || (note.prefix && typeof note.prefix !== 'string') || (note.suffix && typeof note.suffix !== 'string')) return { status: 'unresolved' };
      const text = root.textContent; const positions = matches(text, note.exact);
      let start;
      if (note.occurrence !== undefined) {
        if (!Number.isSafeInteger(note.occurrence) || note.occurrence < 0) return { status: 'unresolved' };
        start = positions[note.occurrence];
        if (start === undefined || !contextMatches(text, start, note)) return { status: 'unresolved' };
      } else {
        const candidates = positions.filter(position => contextMatches(text, position, note));
        if (candidates.length > 1) return { status: 'needs-review' };
        if (candidates.length !== 1) return { status: 'unresolved' };
        start = candidates[0];
      }
      const range = textRange(root, start, start + note.exact.length);
      if (!range || range.toString() !== note.exact) return { status: 'unresolved' };
      if (window.CSS?.highlights && typeof window.Highlight === 'function') window.CSS.highlights.set('study-note-' + (COLORS.includes(note.color) ? note.color : 'yellow'), new window.Highlight(range));
      else { const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); }
      const anchor = range.startContainer.parentElement || root; anchor.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return { status: 'located' };
    }

    function dispose() {
      if (disposed) return;
      reset(); clearHighlight(); disposed = true;
      document.removeEventListener('mouseup', mouseup); window.removeEventListener('hashchange', sessionChanged);
      window.removeEventListener('study-session-ended', sessionChanged); document.removeEventListener('study-session-ended', sessionChanged);
      form.removeEventListener('submit', save); dialog.remove(); style.remove();
      if (activeInstallation === controller) activeInstallation = null;
    }
    cancel.addEventListener('click', reset); dialog.addEventListener('close', () => { if (dialogCapture && !dialog.open) reset(); }); dialog.addEventListener('cancel', reset);
    form.addEventListener('submit', save); document.addEventListener('mouseup', mouseup); window.addEventListener('hashchange', sessionChanged);
    window.addEventListener('study-session-ended', sessionChanged); document.addEventListener('study-session-ended', sessionChanged);
    const controller = { locate, dispose }; activeInstallation = controller; return controller;
  }
  window.StudyNotes = Object.freeze({ install });
})();
