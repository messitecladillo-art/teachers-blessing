import React, { useEffect } from 'react';

export const HkChangelogModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
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
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="版本更新 · v5.0"
        style={{ maxWidth: 640 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <span className="badge badge-info">版本更新 · v5.0</span>
            <h2 style={{ margin: '6px 0 0', fontSize: 20 }}>知学工作台 v5.0 发布说明</h2>
          </div>
          <button type="button" className="hk-collapse-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13.5, color: '#374151' }}>
          <div className="card-compact">
            <strong>1. 分栏互动讲演台（Split-Stage Lecture Studio）</strong>
            <div style={{ color: '#6b7280', marginTop: 4 }}>
              升级点阵白板与分步推演双舞台，支持板书缩放、手写体切换、课堂语音领读、自由画笔批注及右侧对话点击锚点高亮定位。
            </div>
          </div>
          <div className="card-compact">
            <strong>2. 全局快速跳转与检索（Ctrl+K Omnisearch）</strong>
            <div style={{ color: '#6b7280', marginTop: 4 }}>
              顶栏新增快速跳转入口并与 Ctrl+K 联动，支持即时检索全站核心路由、在学课程与讲次（点击讲次直达白板课堂）、学科专题及导出文件，支持方向键与回车直达。
            </div>
          </div>
          <div className="card-compact">
            <strong>3. 错题本与靶向巩固闭环（Error-Book Closed Loop）</strong>
            <div style={{ color: '#6b7280', marginTop: 4 }}>
              打通随堂微测、试卷自动判分、脱敏学情诊断与错题本沉淀，按掌握度动态追踪薄弱点并支持一键生成靶向强化测验与 7 日复习计划。
            </div>
          </div>
          <div className="card-compact">
            <strong>4. 纯前端离线演示运行时（100% Offline GitHub Pages Runtime）</strong>
            <div style={{ color: '#6b7280', marginTop: 4 }}>
              内置完整静态快照与浏览器持久化状态引擎，零后端依赖即可在 GitHub Pages 离线体验建课、白板、速查表与测评闭环，亦可一键接入自有模型服务。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
