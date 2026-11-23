import React, { useEffect } from 'react';
import { handleSafeDownload, resolveApiUrl } from '../services/api';
import { ArtifactItem } from '../types';
import {
  IconCloseX,
  IconDownloadBox,
  IconTrashClean,
  IconLessonDoc,
  IconMindMap,
  IconSlideDeck,
  IconVoiceWave,
  IconCalendarPlan,
  IconVerifyCheck,
  IconAlertWarn,
} from './EduIcons';

interface ArtifactVaultDrawerProps {
  open: boolean;
  onClose: () => void;
  artifacts: ArtifactItem[];
  onDelete: (id: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function categoryMeta(cat: string): { label: string; icon: React.ReactNode } {
  if (cat === 'pptx') {
    return { label: '演示课件', icon: <IconSlideDeck size={18} color="#1B4D3E" /> };
  }
  if (cat === 'mp3') {
    return { label: '试讲音频', icon: <IconVoiceWave size={18} color="#1B4D3E" /> };
  }
  if (cat === 'ics') {
    return { label: '日历日程', icon: <IconCalendarPlan size={18} color="#9A5B13" /> };
  }
  if (cat === 'drawio') {
    return { label: '思维导图', icon: <IconMindMap size={18} color="#1B4D3E" /> };
  }
  if (cat === 'docx_exam_student') {
    return { label: '学生试卷', icon: <IconLessonDoc size={18} color="#1B4D3E" /> };
  }
  if (cat === 'docx_exam_teacher') {
    return { label: '教师解析卷', icon: <IconLessonDoc size={18} color="#166534" /> };
  }
  if (cat === 'docx_analytics') {
    return { label: '成绩报告', icon: <IconLessonDoc size={18} color="#B43B2A" /> };
  }
  return { label: '教学教案', icon: <IconLessonDoc size={18} color="#1B4D3E" /> };
}

export const ArtifactVaultDrawer: React.FC<ArtifactVaultDrawerProps> = ({
  open,
  onClose,
  artifacts,
  onDelete,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer-backdrop" onClick={onClose} data-testid="artifact-vault-drawer">
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid var(--border-hairline)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>已生成文件</h3>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
              支持随时下载或清理本地保存的课件、教案、试卷与导图
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="关闭文件列表" onClick={onClose}>
            <IconCloseX size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {artifacts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--ink-muted)', fontSize: 13.5 }}>
              当前暂无产出物文件，请在工作台生成教案、课件、试卷或学情报告。
            </div>
          ) : (
            artifacts.map((art) => {
              const meta = categoryMeta(art.category);
              return (
                <div
                  key={art.id}
                  className="card-compact"
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: 'var(--bg-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {meta.icon}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink-primary)', lineHeight: 1.35 }}>
                          {art.title}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 2, wordBreak: 'break-all' }}>
                          {art.filename}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <a
                        href={resolveApiUrl(art.download_url)}
                        download={art.filename}
                        onClick={(e) => handleSafeDownload(e, art.download_url, art.filename)}
                        className="btn btn-primary btn-sm"
                        style={{ textDecoration: 'none' }}
                      >
                        <IconDownloadBox size={13} /> 下载
                      </a>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onDelete(art.id)}
                        aria-label="删除产出物"
                        title="删除此产出物"
                      >
                        <IconTrashClean size={14} color="var(--danger)" />
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="badge badge-info">{meta.label}</span>
                    <span className="badge badge-neutral">{formatBytes(art.size_bytes)}</span>
                    {art.verified_status === 'verified' ? (
                      <span className="badge badge-verified">
                        <IconVerifyCheck size={12} /> 已核验
                      </span>
                    ) : (
                      <span className="badge badge-warn">
                        <IconAlertWarn size={12} /> 待复核
                      </span>
                    )}
                    {art.revision_count > 0 && (
                      <span className="badge badge-neutral">修订 {art.revision_count} 次</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
