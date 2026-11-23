import React from 'react';

export const HkChangelogModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <span className="badge badge-info">版本更新 · v4.1</span>
            <h2 style={{ margin: '6px 0 0', fontSize: 20 }}>知学工作台功能清单</h2>
          </div>
          <button type="button" className="hk-collapse-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13.5, color: '#374151' }}>
          <div className="card-compact">
            <strong>1. 课程构建与三栏课程空间</strong>
            <div style={{ color: '#6b7280', marginTop: 4 }}>
              支持从讲义或一句话主题构建多单元课程，集中管理讲次进度、拓展材料、随堂测验与速查表。
            </div>
          </div>
          <div className="card-compact">
            <strong>2. 互动白板课堂</strong>
            <div style={{ color: '#6b7280', marginTop: 4 }}>
              支持点阵板书缩放、手写体与标准体切换、右侧对话历史点击「板书」定位高亮，以及实时追问动态追加推导块。
            </div>
          </div>
          <div className="card-compact">
            <strong>3. 学习动态日历与个人记忆</strong>
            <div style={{ color: '#6b7280', marginTop: 4 }}>
              按月历直观排布 7 日复习计划与到期薄弱知识点，错题自动沉淀并支持一键生成靶向巩固卷。
            </div>
          </div>
          <div className="card-compact">
            <strong>4. 多栏速查表与教学专业工具台</strong>
            <div style={{ color: '#6b7280', marginTop: 4 }}>
              整合可打印重点速查表、题库组卷与在线自动批改、原生可编辑演示课件、教案编辑以及隐私脱敏学情分析。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
