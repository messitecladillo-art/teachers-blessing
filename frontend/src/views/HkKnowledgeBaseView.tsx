import React, { useEffect, useRef, useState } from 'react';
import { apiJson, uploadSourceFile } from '../services/api';
import { SourceChunkHit, SourceDocMeta } from '../types';
import { HkIcon } from '../components/HkAssets';
import { MathText } from '../components/MathText';

interface HkKnowledgeBaseViewProps {
  onBuildCourseFromDoc: (doc: SourceDocMeta) => void;
}

const MATH_TOKEN_RE =
  /((?<!\\)\$\$[\s\S]+?(?<!\\)\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\\)\$(?:\\.|[^\\\n$])+?(?<!\\)\$)/g;

function cleanPlainTexSegment(seg: string): string {
  return seg
    .replace(/\\(?:textbf|text|mathrm)\{([^}]*)\}/g, '$1')
    .replace(/\\mathcal\s*\{([^}]*)\}/g, '$1')
    .replace(/\{\\mathcal\s+([A-Za-z]+)\}/g, '$1')
    .replace(/\\mathcal\s+([A-Za-z]+)/g, '$1')
    .replace(/\\mathbb\s*\{([A-Za-z]+)\}/g, '$1')
    .replace(/\{\\mathbb\s+([A-Za-z]+)\}/g, '$1')
    .replace(/\\mathbb\s+([A-Za-z]+)/g, '$1')
    .replace(/\\(?:emptyset|varnothing)(?![a-zA-Z])/g, '∅')
    .replace(/\\subseteq(?![a-zA-Z])/g, '⊆')
    .replace(/\\subsetneq(?![a-zA-Z])/g, '⊊')
    .replace(/\\subset(?![a-zA-Z])/g, '⊂')
    .replace(/\\supseteq(?![a-zA-Z])/g, '⊇')
    .replace(/\\supset(?![a-zA-Z])/g, '⊃')
    .replace(/\\infty(?![a-zA-Z])/g, '∞')
    .replace(/\\not\s*\\in(?![a-zA-Z])/g, '∉')
    .replace(/\\notin(?![a-zA-Z])/g, '∉')
    .replace(/\\in(?![a-zA-Z])/g, '∈')
    .replace(/\\(?:bigcup|cup)(?![a-zA-Z])/g, '∪')
    .replace(/\\(?:bigcap|cap)(?![a-zA-Z])/g, '∩')
    .replace(/\\setminus(?![a-zA-Z])/g, '∖')
    .replace(/\\Rightarrow(?![a-zA-Z])/g, '⇒')
    .replace(/\\Leftrightarrow(?![a-zA-Z])/g, '⇔')
    .replace(/\\(?:ne|neq)(?![a-zA-Z])/g, '≠')
    .replace(/\\(?:le|leq)(?![a-zA-Z])/g, '≤')
    .replace(/\\(?:ge|geq)(?![a-zA-Z])/g, '≥')
    .replace(/\\times(?![a-zA-Z])/g, '×')
    .replace(/\\pm(?![a-zA-Z])/g, '±')
    .replace(/\\(?:cdots|ldots|dots)(?![a-zA-Z])/g, '…')
    .replace(/\\\{/g, '\uFFF0')
    .replace(/\\\}/g, '\uFFF1')
    .replace(/(?:^|\n)#{1,6}\s+/g, ' ')
    .replace(/(?:^|\n)---+(?=\n|$)/g, ' ')
    .replace(/\\\\+/g, ' ')
    .replace(/[{}`]/g, '')
    .replace(/\uFFF0/g, '{')
    .replace(/\uFFF1/g, '}');
}

function cleanSnippet(text: string): string {
  const pre = (text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\\pause(?![a-zA-Z])\s*/g, '')
    .replace(/\\onslide<[^>]*>\s*/g, '')
    .replace(/\\CJKfamily(?:\{[^}]*\}?)?/g, '')
    .replace(
      /\\(?:title|author|institute|date|usetheme|useinnertheme|setbeamercovered|hypersetup|usepackage|documentclass|renewcommand|frametitle|tableofcontents)(?:\[[^\]]*\])?(?:\{[^}]*\})*/g,
      ' '
    )
    .replace(/\\frame\{(?:\\titlepage)?\}/g, ' ')
    .replace(
      /\\(?:begin|end)\{(?:document|frame|description|itemize|enumerate|CJK)\}(?:<[^>]*>)?(?:\[[^\]]*\])?(?:\{[^}]*\})*/g,
      ' '
    )
    .replace(/\\begin\{block\}\{([^}]*)\}/g, '**【$1】** ')
    .replace(/\\end\{block\}/g, ' ')
    .replace(/\\alert\{([^}]*)\}/g, '**$1**')
    .replace(/\\item\s*\[([^\]]+)\]\s*/g, ' • **$1**：')
    .replace(/\\item(?![a-zA-Z])\s*/g, ' • ')
    .replace(/\\(?:Large|large|huge|Huge|small|normalsize|footnotesize|scriptsize|tiny)(?![a-zA-Z])\s*/g, '')
    .replace(/\\text\{([^{}]*)\}/g, (full, inner: string) => {
      if (!inner.includes('$')) return full;
      return inner
        .split(/(\$[^$]+\$)/g)
        .map((part) =>
          part.startsWith('$') && part.endsWith('$')
            ? ` ${part.slice(1, -1)} `
            : part
            ? `\\text{${part}}`
            : ''
        )
        .join('');
    });

  const out: string[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  MATH_TOKEN_RE.lastIndex = 0;
  while ((m = MATH_TOKEN_RE.exec(pre)) !== null) {
    if (m.index > lastIdx) {
      out.push(cleanPlainTexSegment(pre.slice(lastIdx, m.index)));
    }
    out.push(m[0]);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < pre.length) {
    out.push(cleanPlainTexSegment(pre.slice(lastIdx)));
  }

  return out
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateMathSafe(text: string, maxChars = 260): string {
  if (text.length <= maxChars) return text;
  const out: string[] = [];
  let count = 0;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  MATH_TOKEN_RE.lastIndex = 0;

  while ((m = MATH_TOKEN_RE.exec(text)) !== null) {
    if (m.index > lastIdx) {
      const plain = text.slice(lastIdx, m.index);
      if (count + plain.length >= maxChars) {
        out.push(plain.slice(0, Math.max(0, maxChars - count)));
        return `${out.join('').trimEnd()}…`;
      }
      out.push(plain);
      count += plain.length;
    }
    const tok = m[0];
    if (count + tok.length > maxChars && count > 0) {
      return `${out.join('').trimEnd()}…`;
    }
    out.push(tok);
    count += tok.length;
    lastIdx = m.index + tok.length;
  }

  if (lastIdx < text.length) {
    const rem = text.slice(lastIdx);
    if (count + rem.length > maxChars) {
      out.push(rem.slice(0, Math.max(0, maxChars - count)));
      return `${out.join('').trimEnd()}…`;
    }
    out.push(rem);
  }
  return out.join('');
}

export const HkKnowledgeBaseView: React.FC<HkKnowledgeBaseViewProps> = ({ onBuildCourseFromDoc }) => {
  const [docs, setDocs] = useState<SourceDocMeta[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SourceChunkHit[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [activeDoc, setActiveDoc] = useState<SourceDocMeta | null>(null);
  const [chunks, setChunks] = useState<SourceChunkHit[]>([]);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!activeDoc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveDoc(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeDoc]);

  const loadDocs = async () => {
    try {
      const res = await apiJson<{ documents: SourceDocMeta[] }>('/api/sources/list');
      setDocs(res.documents || []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void loadDocs();
  }, []);

  const handleDeleteDoc = async (docId: string) => {
    setDeletingId(docId);
    setErrorMsg('');
    try {
      await apiJson(`/api/sources/${docId}`, { method: 'DELETE' });
      if (activeDoc?.id === docId) setActiveDoc(null);
      setHits((prev) => prev.filter((h) => h.doc_id !== docId));
      setConfirmDeleteId(null);
      await loadDocs();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '删除文档失败，请稍后重试');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSearch = async () => {
    if (!query.trim()) {
      setHits([]);
      setHasSearched(false);
      return;
    }
    setSearching(true);
    setErrorMsg('');
    try {
      const res = await apiJson<{ results: SourceChunkHit[] }>(
        `/api/sources/search?q=${encodeURIComponent(query.trim())}&limit=8`
      );
      setHits(res.results || []);
      setHasSearched(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '检索资料失败，请稍后重试');
    } finally {
      setSearching(false);
    }
  };

  const handleInspectDoc = async (doc: SourceDocMeta) => {
    setActiveDoc(doc);
    try {
      const res = await apiJson<{ chunks: SourceChunkHit[] }>(`/api/sources/${doc.id}/chunks`);
      setChunks(res.chunks || []);
    } catch {
      setChunks([]);
    }
  };

  const handleInspectHit = (hit: SourceChunkHit) => {
    const parentDoc =
      docs.find((d) => d.id === hit.doc_id) ||
      ({
        id: hit.doc_id,
        filename: hit.doc_title,
        title: hit.doc_title,
        char_count: 0,
        chunk_count: 0,
        quality_note: '',
        created_at: 0,
      } satisfies SourceDocMeta);
    void handleInspectDoc(parentDoc);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setUploading(true);
    setErrorMsg('');
    try {
      await uploadSourceFile(f);
      await loadDocs();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '文件上传解析失败，请检查文档格式后重试');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="hk-page-wrap">
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.docx,.pptx,.xlsx,.md,.txt,.csv,.tex,.html,.zip"
        style={{ display: 'none' }}
        onChange={handleUpload}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <HkIcon name="kb" size={24} />
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>个人知识库</h1>
          <span className="badge badge-neutral">已收录 {docs.length} 份文档</span>
        </div>

        <button type="button" className="btn btn-primary btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? '正在解析…' : '+ 上传新资料'}
        </button>
      </div>

      {errorMsg && (
        <div className="callout-danger" style={{ marginBottom: 18, fontSize: 13 }}>
          {errorMsg}
        </div>
      )}

      {/* Search Bar */}
      <div style={{ display: 'flex', gap: 10, maxWidth: 640, marginBottom: 24 }}>
        <input
          className="input"
          style={{ borderRadius: 999, height: 42, paddingLeft: 18 }}
          placeholder="搜索讲义、定义或章节内容（例如：陪集、定义域、德摩根律）..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value.trim()) {
              setHits([]);
              setHasSearched(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              void handleSearch();
            }
          }}
        />
        <button type="button" className="btn btn-surface" disabled={searching} onClick={handleSearch}>
          {searching ? '检索中…' : '检索章节'}
        </button>
      </div>

      {hasSearched && !searching && hits.length === 0 && (
        <div className="paper-folio" style={{ padding: '26px 20px', textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: '#181a1f', marginBottom: 6 }}>
            未检索到与「{query.trim()}」匹配的章节内容
          </div>
          <div style={{ fontSize: 12.5, color: '#6b7280', marginBottom: 12 }}>
            可尝试更换关键词，或上传补充讲义后重新检索。
          </div>
          <button
            type="button"
            className="btn btn-surface btn-sm"
            onClick={() => {
              setQuery('');
              setHits([]);
              setHasSearched(false);
            }}
          >
            清除检索条件
          </button>
        </div>
      )}

      {hits.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ fontSize: 15 }}>匹配章节片段 ({hits.length})</strong>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setHits([]);
                setHasSearched(false);
              }}
            >
              清除检索
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {hits.map((h) => (
              <button
                key={h.id}
                type="button"
                className="paper-folio"
                style={{ width: '100%', padding: '14px 18px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={() => handleInspectHit(h)}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#3b4f7d' }}>
                    {h.doc_title} · <MathText text={cleanSnippet(h.chapter_title)} inline />
                  </div>
                  <span style={{ fontSize: 11.5, color: '#3b4f7d', fontWeight: 600, flexShrink: 0 }}>
                    查看所属文档 →
                  </span>
                </div>
                <div style={{ fontSize: 13.5, color: '#374151', marginTop: 6, lineHeight: 1.6 }}>
                  <MathText text={truncateMathSafe(cleanSnippet(h.content), 260)} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Documents List */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 16 }}>
        {docs.map((d) => (
          <div key={d.id} className="paper-folio" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span className="badge badge-info">{d.chunk_count} 个章节段落</span>
                <span className="mono-num" style={{ fontSize: 11.5, color: '#9ca3af' }}>{d.char_count} 字</span>
              </div>
              <h3 style={{ margin: '10px 0 4px', fontSize: 16.5 }}>{d.title}</h3>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{d.filename}</div>
              {d.quality_note && (
                <div style={{ fontSize: 12, color: '#166534', marginTop: 6 }}>{d.quality_note}</div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => onBuildCourseFromDoc(d)}>
                打造课程
              </button>
              <button type="button" className="btn btn-surface btn-sm" onClick={() => handleInspectDoc(d)}>
                查看章节
              </button>
              {confirmDeleteId === d.id ? (
                <>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ background: '#dc2626', color: '#ffffff' }}
                    disabled={deletingId === d.id}
                    onClick={() => handleDeleteDoc(d.id)}
                  >
                    {deletingId === d.id ? '删除中…' : '确认删除'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDeleteId(null)}>
                    取消
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ color: '#b91c1c' }}
                  onClick={() => setConfirmDeleteId(d.id)}
                >
                  删除
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Document Chunks Modal */}
      {activeDoc && (
        <div className="modal-backdrop" onClick={() => setActiveDoc(null)}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label={`${activeDoc.title} · 分章内容`}
            style={{ maxWidth: 680 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 19 }}>{activeDoc.title} · 分章内容</h2>
              <button
                type="button"
                className="hk-collapse-btn"
                aria-label="关闭"
                onClick={() => setActiveDoc(null)}
              >
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {chunks.map((ch) => (
                <div key={ch.id} className="card-compact">
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: '#3b4f7d', marginBottom: 6 }}>
                    <MathText text={cleanSnippet(ch.chapter_title)} inline />
                  </div>
                  <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
                    <MathText text={cleanSnippet(ch.content)} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
