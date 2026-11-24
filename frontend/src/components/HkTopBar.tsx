import React, { useEffect, useState } from 'react';
import { isStaticDemoMode } from '../services/api';
import { HkRoute, HomeTab, LLMStatusSummary } from '../types';
import { UI_LABELS } from '../utils/i18n';
import { HkScholarAvatar } from './HkAssets';

interface HkTopBarProps {
  route: HkRoute;
  homeTab: HomeTab;
  sidebarCollapsed: boolean;
  llmStatus: LLMStatusSummary | null;
  artifactCount: number;
  onExpandSidebar: () => void;
  onOpenMobileMenu: () => void;
  onChangeHomeTab: (tab: HomeTab) => void;
  onOpenVault: () => void;
  onOpenSettings: (tab?: 'general' | 'memory' | 'model') => void;
  onNavigate: (route: HkRoute) => void;
  onOpenPedagogy: () => void;
  onOpenInsights: () => void;
  onBackFromTool?: () => void;
  onOpenCommandPalette?: () => void;
}

export const HkTopBar: React.FC<HkTopBarProps> = ({
  route,
  homeTab,
  sidebarCollapsed,
  llmStatus,
  artifactCount,
  onExpandSidebar,
  onOpenMobileMenu,
  onChangeHomeTab,
  onOpenVault,
  onOpenSettings,
  onNavigate,
  onOpenPedagogy,
  onOpenInsights,
  onBackFromTool,
  onOpenCommandPalette,
}) => {
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const t = UI_LABELS.zh;
  const isToolRoute = route.startsWith('tool_');

  useEffect(() => {
    if (!avatarMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAvatarMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [avatarMenuOpen]);

  return (
    <header className="hk-topbar">
      <div className="hk-topbar-left">
        <button
          type="button"
          className="hk-icon-square-btn hk-mobile-menu-btn"
          aria-label="打开导航菜单"
          onClick={onOpenMobileMenu}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        {sidebarCollapsed && (
          <button
            type="button"
            className="hk-icon-square-btn hk-hide-mobile"
            aria-label="展开侧边栏"
            title="展开侧边栏"
            onClick={onExpandSidebar}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 17l5-5-5-5" />
              <path d="M6 17l5-5-5-5" />
            </svg>
          </button>
        )}

        {isToolRoute && onBackFromTool && (
          <button type="button" className="hk-pill-control" onClick={onBackFromTool}>
            <span>←</span>
            <span>返回工作台</span>
          </button>
        )}
      </div>

      <div className="hk-topbar-center">
        {route === 'home' && (
          <div className="hk-mode-switcher" role="tablist" aria-label="首页工作模式">
            <button
              type="button"
              role="tab"
              aria-selected={homeTab === 'craft'}
              className={`hk-mode-btn ${homeTab === 'craft' ? 'active' : ''}`}
              onClick={() => onChangeHomeTab('craft')}
            >
              {t.modeCraft}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={homeTab === 'instant'}
              className={`hk-mode-btn ${homeTab === 'instant' ? 'active' : ''}`}
              onClick={() => onChangeHomeTab('instant')}
            >
              {t.modeInstant}
            </button>
          </div>
        )}
      </div>

      <div className="hk-topbar-right">
        {onOpenCommandPalette && (
          <button
            type="button"
            className="hk-pill-control"
            data-testid="topbar-cmdk-btn"
            title="全局搜索与快速跳转 (Ctrl+K)"
            aria-label="快速跳转 Ctrl+K"
            onClick={onOpenCommandPalette}
          >
            <span aria-hidden="true">🔍</span>
            <span>快速跳转</span>
            <kbd
              className="mono-num"
              style={{
                background: '#f1f3f6',
                border: '1px solid #e2e6ee',
                padding: '1px 6px',
                borderRadius: 6,
                fontSize: 11,
                color: '#6b7280',
              }}
            >
              Ctrl+K
            </kbd>
          </button>
        )}

        <button
          type="button"
          className="hk-pill-control hk-hide-mobile"
          title={
            isStaticDemoMode()
              ? '当前为静态在线演示模式（可点击绑定自有后端）'
              : llmStatus?.model
              ? `当前模型：${llmStatus.model}`
              : '查看模型连接'
          }
          onClick={() => onOpenSettings('model')}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '999px',
              background: isStaticDemoMode()
                ? '#2563eb'
                : llmStatus?.has_api_key
                ? '#16a34a'
                : '#d97706',
              display: 'inline-block',
            }}
          />
          <span>{isStaticDemoMode() ? '在线演示' : t.statusReady}</span>
        </button>

        <button
          type="button"
          className="hk-pill-control hk-hide-mobile"
          onClick={onOpenVault}
        >
          <span>{t.exportVault}</span>
          <span className="mono-num" style={{ background: '#f1f3f6', padding: '1px 6px', borderRadius: 999, fontSize: 11 }}>
            {artifactCount}
          </span>
        </button>

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            aria-label="用户账户与设置"
            style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', display: 'flex', borderRadius: '999px' }}
            onClick={() => setAvatarMenuOpen((v) => !v)}
          >
            <HkScholarAvatar size={34} />
          </button>

          {avatarMenuOpen && (
            <>
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 55 }}
                onClick={() => setAvatarMenuOpen(false)}
              />
              <div className="hk-popover-menu right" style={{ minWidth: 210 }}>
                <div style={{ padding: '8px 10px', borderBottom: '1px solid #eef0f3', marginBottom: 4 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#181a1f' }}>知学研习者</div>
                  <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>本地独立学习与教研账号</div>
                </div>
                <button
                  type="button"
                  className="hk-popover-row"
                  onClick={() => {
                    setAvatarMenuOpen(false);
                    onOpenSettings('general');
                  }}
                >
                  <span>常规设置</span>
                </button>
                <button
                  type="button"
                  className="hk-popover-row"
                  onClick={() => {
                    setAvatarMenuOpen(false);
                    onOpenSettings('memory');
                  }}
                >
                  <span>学习记忆与薄弱点</span>
                </button>
                <button
                  type="button"
                  className="hk-popover-row"
                  onClick={() => {
                    setAvatarMenuOpen(false);
                    onOpenVault();
                  }}
                >
                  <span>导出文件库 ({artifactCount})</span>
                </button>
                <button
                  type="button"
                  className="hk-popover-row"
                  onClick={() => {
                    setAvatarMenuOpen(false);
                    onNavigate('kb');
                  }}
                >
                  <span>个人知识库</span>
                </button>
                <button
                  type="button"
                  className="hk-popover-row"
                  onClick={() => {
                    setAvatarMenuOpen(false);
                    onOpenPedagogy();
                  }}
                >
                  <span>全学科教学法库 (52)</span>
                </button>
                <button
                  type="button"
                  className="hk-popover-row"
                  onClick={() => {
                    setAvatarMenuOpen(false);
                    onOpenInsights();
                  }}
                >
                  <span>隐私控制与统计</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
