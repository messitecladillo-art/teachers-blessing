import React, { useEffect, useRef, useState } from 'react';
import { apiJson, uploadSourceFile } from '../services/api';
import { SourceChunkHit, SourceDocMeta } from '../types';
import { HkIcon } from '../components/HkAssets';

interface HkKnowledgeBaseViewProps {
  onBuildCourseFromDoc: (doc: SourceDocMeta) => void;
}

function cleanSnippet(text: string): string {
  return (text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\$\$?/g, '')
    .replace(/\*\*/g, '')
    .replace(/\\CJKfamily(?:\{[^}]*\}?)?/g, '')
    .replace(/\\(?:title|author|institute|date)(?:\[[^\]]*\])?(?:\{[^}]*\}?)*/g, ' ')
    .replace(/\\(?:Large|small|normalsize|footnotesize)\b\s*/g, '')
    .replace(/\\(?:textbf|text|mathrm)\{([^}]*)\}/g, '$1')
    .replace(/\\infty(?![a-zA-Z])/g, '∞')
    .replace(/\\not\s*\\in(?![a-zA-Z])/g, '∉')
    .replace(/\\(?:bigcup|cup)(?![a-zA-Z])/g, '∪')
    .replace(/\\(?:bigcap|cap)(?![a-zA-Z])/g, '∩')
    .replace(/\\setminus(?![a-zA-Z])/g, '\\')
    .replace(/\\subseteq(?![a-zA-Z])/g, '⊆')
    .replace(/\\Rightarrow(?![a-zA-Z])/g, '⇒')
    .replace(/\\notin(?![a-zA-Z])/g, '∉')
    .replace(/\\in(?![a-zA-Z])/g, '∈')
    .replace(/\\mathbb\{([A-Z])\}/g, '$1')
    .replace(/\\mathbb\s+([A-Z])/g, '$1')
    .replace(/\\(?:cdots|ldots|dots)(?![a-zA-Z])/g, '…')
    .replace(/\\\\+/g, ' ')
    .replace(/[{}`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const HkKnowledgeBaseView: React.FC<HkKnowledgeBaseViewProps> = ({ onBuildCourseFromDoc }) => {
  const [docs, setDocs] = useState<SourceDocMeta[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SourceChunkHit[]>([]);
  const [activeDoc, setActiveDoc] = useState<SourceDocMeta | null>(null);
  const [chunks, setChunks] = useState<SourceChunkHit[]>([]);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleDeleteDoc = async (docId: string) => {
    setDeletingId(docId);
    try {
      await apiJson(`/api/sources/${docId}`, { method: 'DELETE' });
      if (activeDoc?.id === docId) setActiveDoc(null);
      setConfirmDeleteId(null);
      await loadDocs();
    } catch {
      /* ignore */
    } finally {
      setDeletingId(null);
    }
  };

  const loadDocs = async () => {
    try {
      const res = await apiJson<{ documents: SourceDocMeta[] }>('/api/sources/list');
      setDocs(res.documents || []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    loadDocs();
  }, []);

  const handleSearch = async () => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    try {
      const res = await apiJson<{ results: SourceChunkHit[] }>(`/api/sources/search?q=${encodeURIComponent(query.trim())}&limit=8`);
      setHits(res.results || []);
    } catch {
      /* ignore */
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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setUploading(true);
    try {
      await uploadSourceFile(f);
      await loadDocs();
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

      {/* Search Bar */}
      <div style={{ display: 'flex', gap: 10, maxWidth: 640, marginBottom: 24 }}>
        <input
          className="input"
          style={{ borderRadius: 999, height: 42, paddingLeft: 18 }}
          placeholder="搜索讲义、定义或章节内容（例如：陪集、定义域、德摩根律）..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
          }}
        />
        <button type="button" className="btn btn-surface" onClick={handleSearch}>
          检索章节
        </button>
      </div>

      {hits.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ fontSize: 15 }}>匹配章节片段 ({hits.length})</strong>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHits([])}>
              清除检索
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {hits.map((h) => (
              <div key={h.id} className="paper-folio" style={{ padding: '14px 18px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#3b4f7d' }}>
                  {h.doc_title} · {cleanSnippet(h.chapter_title)}
                </div>
                <div style={{ fontSize: 13.5, color: '#374151', marginTop: 6, lineHeight: 1.6 }}>
                  {cleanSnippet(h.content).slice(0, 260)}...
                </div>
              </div>
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
          <div className="modal-panel" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 19 }}>{activeDoc.title} · 分章内容</h2>
              <button type="button" className="hk-collapse-btn" onClick={() => setActiveDoc(null)}>
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {chunks.map((ch) => (
                <div key={ch.id} className="card-compact">
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: '#3b4f7d', marginBottom: 6 }}>
                    {cleanSnippet(ch.chapter_title)}
                  </div>
                  <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{cleanSnippet(ch.content)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
