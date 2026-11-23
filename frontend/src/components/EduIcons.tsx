import React from 'react';

export interface IconProps {
  size?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

const baseProps = (size: number, color: string, className?: string, style?: React.CSSProperties) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: color,
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  style: { flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style },
});

/** 1. 原创品牌徽章 */
export const BrandCrestIcon: React.FC<IconProps> = ({ size = 22, color = '#FFFFFF', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M12 3L3.5 7.5L12 12L20.5 7.5L12 3Z" fill={color} fillOpacity="0.22" />
    <path d="M6.5 9.6V15.4C6.5 17.2 8.9 19 12 19C15.1 19 17.5 17.2 17.5 15.4V9.6" />
    <path d="M20.5 8.5V14.2" />
    <circle cx="12" cy="14.5" r="1.4" fill={color} stroke="none" />
  </svg>
);

/** 2. 学习中心 · 可靠答疑棱镜 */
export const IconTutorPrism: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M4.5 6.5C4.5 5.4 5.4 4.5 6.5 4.5H17.5C18.6 4.5 19.5 5.4 19.5 6.5V17.5C19.5 18.6 18.6 19.5 17.5 19.5H6.5C5.4 19.5 4.5 18.6 4.5 17.5V6.5Z" fill={color} fillOpacity="0.12" />
    <path d="M12 7.5L15.5 14.5H8.5L12 7.5Z" />
    <path d="M12 3V4.5M12 19.5V21" />
  </svg>
);

/** 3. 教学工坊 · 微格讲台黑板 */
export const IconTeachLectern: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <rect x="3.5" y="4.5" width="17" height="11.5" rx="2.5" fill={color} fillOpacity="0.14" />
    <path d="M8 9.5H13.5M8 12.5H11" />
    <circle cx="16.2" cy="11" r="1.3" fill={color} stroke="none" />
    <path d="M9 16L7 20M15 16L17 20M6 20H18" />
  </svg>
);

/** 4. 学→教 双向流转桥 */
export const IconBridgeFlow: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <circle cx="6" cy="8" r="2.5" fill={color} fillOpacity="0.2" />
    <circle cx="18" cy="16" r="2.5" fill={color} fillOpacity="0.2" />
    <path d="M8.5 8H14.5C16.7 8 18 9.3 18 11.5V12.5" />
    <path d="M15.5 10.5L18 13L20.5 10.5" />
    <path d="M15.5 16H9.5C7.3 16 6 14.7 6 12.5V11.5" />
  </svg>
);

/** 5. 产出物保险箱 */
export const IconVaultBox: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" fill={color} fillOpacity="0.12" />
    <path d="M3.5 10.5H8.5L10 12.5H14L15.5 10.5H20.5" />
    <path d="M8 7.5H16" />
  </svg>
);

/** 6. 问卷闭环与指标趋势 */
export const IconSurveyChart: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <rect x="4" y="12.5" width="3.5" height="7" rx="1" fill={color} fillOpacity="0.18" />
    <rect x="10.2" y="8.5" width="3.5" height="11" rx="1" fill={color} fillOpacity="0.18" />
    <rect x="16.5" y="5" width="3.5" height="14.5" rx="1" fill={color} fillOpacity="0.18" />
    <path d="M4.5 9L10.5 5.5L17.5 3.2" />
  </svg>
);

/** 7. 知乎讲法锦囊库（指北针书页） */
export const IconCompassBook: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M4 6.5C4 5.4 4.9 4.5 6 4.5H10.5C11.3 4.5 12 5.2 12 6V18.5C12 17.7 11.3 17 10.5 17H6C4.9 17 4 16.1 4 15V6.5Z" fill={color} fillOpacity="0.12" />
    <path d="M20 6.5C20 5.4 19.1 4.5 18 4.5H13.5C12.7 4.5 12 5.2 12 6V18.5C12 17.7 12.7 17 13.5 17H18C19.1 17 20 16.1 20 15V6.5Z" fill={color} fillOpacity="0.12" />
    <circle cx="16" cy="10.5" r="2" />
  </svg>
);

/** 8. 隐私脱敏与安全盾 */
export const IconShieldLock: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M12 3.2L19 6.2V11.8C19 16.2 16 19.6 12 20.8C8 19.6 5 16.2 5 11.8V6.2L12 3.2Z" fill={color} fillOpacity="0.14" />
    <path d="M9.5 12L11.2 13.7L14.8 10.1" />
  </svg>
);

/** 9. 网关设置齿轮滑块 */
export const IconGatewaySliders: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M4 7H9M13 7H20M4 12H14M18 12H20M4 17H7M11 17H20" />
    <circle cx="11" cy="7" r="2" fill={color} fillOpacity="0.2" />
    <circle cx="16" cy="12" r="2" fill={color} fillOpacity="0.2" />
    <circle cx="9" cy="17" r="2" fill={color} fillOpacity="0.2" />
  </svg>
);

/** 10. 启发星芒 */
export const IconSparkPulse: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M12 3.5L14 9.5L20 11.5L14 13.5L12 19.5L10 13.5L4 11.5L10 9.5L12 3.5Z" fill={color} fillOpacity="0.18" />
    <circle cx="18.5" cy="5.5" r="1.2" fill={color} stroke="none" />
  </svg>
);

/** 11. 符号算子计算图标 */
export const IconSympySigma: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <rect x="4" y="3.5" width="16" height="17" rx="3" fill={color} fillOpacity="0.12" />
    <path d="M15.5 7.5H9L13 12L9 16.5H15.5" />
  </svg>
);

/** 12. 启发提示灯泡 */
export const IconHintBulb: React.FC<IconProps> = ({ size = 18, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M9 17.5H15M9.8 20H14.2M12 3.5C8.9 3.5 6.5 5.9 6.5 9C6.5 11.1 7.6 12.9 9.2 13.9C9.6 14.2 9.8 14.6 9.8 15.1V15.5H14.2V15.1C14.2 14.6 14.4 14.2 14.8 13.9C16.4 12.9 17.5 11.1 17.5 9C17.5 5.9 15.1 3.5 12 3.5Z" fill={color} fillOpacity="0.14" />
  </svg>
);

/** 13. 解锁下一级 */
export const IconUnlockStep: React.FC<IconProps> = ({ size = 14, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" fill={color} fillOpacity="0.14" />
    <path d="M8.5 10.5V7.5C8.5 5.6 10.1 4 12 4C13.6 4 14.9 5 15.3 6.4" />
    <circle cx="12" cy="15.2" r="1.2" fill={color} stroke="none" />
  </svg>
);

/** 14. 错题星标书本 */
export const IconErrorBookmark: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M5.5 4.5C5.5 3.7 6.2 3 7 3H17.5C18.3 3 19 3.7 19 4.5V19.5C19 20.3 18.3 21 17.5 21H7C6.2 21 5.5 20.3 5.5 19.5V4.5Z" fill={color} fillOpacity="0.12" />
    <path d="M9.5 3V10.5L12 8.8L14.5 10.5V3" fill={color} fillOpacity="0.22" />
    <path d="M9 15H15" />
  </svg>
);

/** 15. 收藏至错题本 */
export const IconBookmarkPlus: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M6.5 4.5C6.5 3.7 7.2 3 8 3H16C16.8 3 17.5 3.7 17.5 4.5V20.5L12 17L6.5 20.5V4.5Z" fill={color} fillOpacity="0.14" />
    <path d="M12 8V12.5M9.8 10.2H14.2" />
  </svg>
);

/** 16. 7日复习计划日历 */
export const IconCalendarPlan: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" fill={color} fillOpacity="0.12" />
    <path d="M3.5 9.5H20.5M8 3.2V6.2M16 3.2V6.2" />
    <path d="M9 14.5L11 16.5L15.2 12.3" />
  </svg>
);

/** 17. Word 教案/讲义文档 */
export const IconLessonDoc: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M6.5 3.5H14L18.5 8V19.5C18.5 20.1 18 20.5 17.5 20.5H6.5C5.9 20.5 5.5 20.1 5.5 19.5V4.5C5.5 3.9 5.9 3.5 6.5 3.5Z" fill={color} fillOpacity="0.12" />
    <path d="M14 3.5V8H18.5M8.5 12H15.5M8.5 15.5H13.5" />
  </svg>
);

/** 18. 原生 PPT 幻灯片画框 */
export const IconSlideDeck: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <rect x="3" y="4.5" width="18" height="12.5" rx="2.5" fill={color} fillOpacity="0.14" />
    <path d="M7.5 9H12M7.5 12H10.5M12 17V20.5M8.5 20.5H15.5" />
    <circle cx="15.8" cy="10.8" r="2" fill={color} fillOpacity="0.25" />
  </svg>
);

/** 19. 智能出题组卷细目表 */
export const IconExamPaper: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <rect x="4" y="3.5" width="16" height="17" rx="2.5" fill={color} fillOpacity="0.12" />
    <path d="M4 9H20M9.5 9V20.5M13.5 13H17M13.5 16.5H17" />
    <path d="M6 14.5L7 15.5L8.5 13.5" />
  </svg>
);

/** 20. 学情分析直方与曲线 */
export const IconAnalyticsRadar: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <rect x="3.5" y="4" width="17" height="16" rx="3" fill={color} fillOpacity="0.10" />
    <path d="M7 16V12M12 16V8M17 16V10" strokeWidth={2.2} />
    <path d="M6.5 9.5C8.5 7 11 6.8 13.2 8.5C14.8 9.7 16.5 8 17.8 6.5" />
  </svg>
);

/** 21. 主题调色盘 */
export const IconPaletteSwatch: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M12 3.5C7.3 3.5 3.5 7.2 3.5 11.8C3.5 15.4 6 18 9 18C10.1 18 10.8 18.8 10.8 19.6C10.8 20.1 11.3 20.5 12 20.5C16.8 20.5 20.5 16.8 20.5 12C20.5 7.3 16.7 3.5 12 3.5Z" fill={color} fillOpacity="0.12" />
    <circle cx="8.5" cy="10" r="1.1" fill={color} stroke="none" />
    <circle cx="12" cy="7.5" r="1.1" fill={color} stroke="none" />
    <circle cx="15.8" cy="10" r="1.1" fill={color} stroke="none" />
  </svg>
);

/** 22. 沉浸试讲全屏取景框 */
export const IconStageExpand: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M4 9V4H9M15 4H20V9M20 15V20H15M9 20H4V15" />
    <rect x="7.5" y="7.5" width="9" height="9" rx="1.5" fill={color} fillOpacity="0.16" />
  </svg>
);

/** 23. 微格语音合成声波 */
export const IconVoiceWave: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M4 10V14M8 7V17M12 4.5V19.5M16 8V16M20 10.5V13.5" strokeWidth={2} />
  </svg>
);

/** 24. 核验通过棱镜徽章 */
export const IconVerifyCheck: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <circle cx="12" cy="12" r="8.5" fill={color} fillOpacity="0.16" />
    <path d="M8.5 12.2L10.8 14.5L15.6 9.6" />
  </svg>
);

/** 25. 警示与需复核 */
export const IconAlertWarn: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M12 3.8L20.5 18.8C20.9 19.5 20.4 20.3 19.6 20.3H4.4C3.6 20.3 3.1 19.5 3.5 18.8L12 3.8Z" fill={color} fillOpacity="0.15" />
    <path d="M12 9.5V14" />
    <circle cx="12" cy="17" r="1" fill={color} stroke="none" />
  </svg>
);

/** 26. 上传导入 */
export const IconUploadCloud: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M12 15.5V5.5M8.5 9L12 5.5L15.5 9" />
    <path d="M4.5 15.5V18C4.5 19.1 5.4 20 6.5 20H17.5C18.6 20 19.5 19.1 19.5 18V15.5" />
  </svg>
);

/** 27. 下载导出 */
export const IconDownloadBox: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M12 4.5V14.5M8.5 11L12 14.5L15.5 11" />
    <path d="M4.5 15.5V18C4.5 19.1 5.4 20 6.5 20H17.5C18.6 20 19.5 19.1 19.5 18V15.5" />
  </svg>
);

/** 28. 保存编译 */
export const IconSaveDisc: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M5 4.5H16.5L19.5 7.5V18.5C19.5 19.3 18.8 20 18 20H5C4.2 20 3.5 19.3 3.5 18.5V6C3.5 5.2 4.2 4.5 5 4.5Z" fill={color} fillOpacity="0.12" />
    <path d="M7.5 4.5V9.5H14.5V4.5M8 20V14H15V20" />
  </svg>
);

/** 29. AI 精修魔法棒 */
export const IconWandRefine: React.FC<IconProps> = ({ size = 14, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M4.5 19.5L15.5 8.5" strokeWidth={2} />
    <path d="M17 3.5L17.8 5.7L20 6.5L17.8 7.3L17 9.5L16.2 7.3L14 6.5L16.2 5.7L17 3.5Z" fill={color} stroke="none" />
    <circle cx="8" cy="6" r="1.1" fill={color} stroke="none" />
  </svg>
);

/** 30. 换一换双向刷新 */
export const IconRefreshSwap: React.FC<IconProps> = ({ size = 14, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M4.5 11.5C4.5 7.6 7.6 4.5 11.5 4.5C14.1 4.5 16.4 5.9 17.6 8" />
    <path d="M15 8.5H18.2V5.3" />
    <path d="M19.5 12.5C19.5 16.4 16.4 19.5 12.5 19.5C9.9 19.5 7.6 18.1 6.4 16" />
    <path d="M9 15.5H5.8V18.7" />
  </svg>
);

/** 31. 预览脱敏光学眼 */
export const IconEyePreview: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M2.5 12C4.8 7.6 8.2 5.5 12 5.5C15.8 5.5 19.2 7.6 21.5 12C19.2 16.4 15.8 18.5 12 18.5C8.2 18.5 4.8 16.4 2.5 12Z" fill={color} fillOpacity="0.12" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

/** 32. 教师人工复核签章 */
export const IconTeacherSign: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <circle cx="9.5" cy="8" r="3" fill={color} fillOpacity="0.16" />
    <path d="M4 18.5C4 15.5 6.5 13.5 9.5 13.5C11.1 13.5 12.5 14 13.5 15" />
    <path d="M14.5 17.5L16.5 19.5L20.5 15" />
  </svg>
);

/** 33. 删除与清除 */
export const IconTrashClean: React.FC<IconProps> = ({ size = 14, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M4.5 6.5H19.5M9.5 4H14.5M7 6.5L7.8 19C7.9 19.8 8.5 20.5 9.4 20.5H14.6C15.5 20.5 16.1 19.8 16.2 19L17 6.5" />
    <path d="M10.5 10.5V16.5M13.5 10.5V16.5" />
  </svg>
);

/** 34. 基础控制小图标 */
export const IconCloseX: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M6 6L18 18M18 6L6 18" />
  </svg>
);

export const IconChevronLeft: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M14.5 6L8.5 12L14.5 18" />
  </svg>
);

export const IconChevronRight: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M9.5 6L15.5 12L9.5 18" />
  </svg>
);

export const IconChevronDown: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M6 9.5L12 15.5L18 9.5" />
  </svg>
);

export const IconSpinnerOrbit: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className = 'spin', style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <circle cx="12" cy="12" r="8.5" strokeOpacity="0.22" />
    <path d="M12 3.5A8.5 8.5 0 0 1 20.5 12" />
  </svg>
);

export const IconClockTimer: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <circle cx="12" cy="12.5" r="8" fill={color} fillOpacity="0.12" />
    <path d="M12 8.5V12.5L14.8 14.2M9.5 3H14.5" />
  </svg>
);

export const IconCrossCircle: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <circle cx="12" cy="12" r="8.5" fill={color} fillOpacity="0.14" />
    <path d="M9.5 9.5L14.5 14.5M14.5 9.5L9.5 14.5" />
  </svg>
);

export const IconEditPen: React.FC<IconProps> = ({ size = 14, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M4.5 19.5L8.2 18.8L18.5 8.5C19.2 7.8 19.2 6.7 18.5 6L18 5.5C17.3 4.8 16.2 4.8 15.5 5.5L5.2 15.8L4.5 19.5Z" fill={color} fillOpacity="0.14" />
    <path d="M13.5 7.5L16.5 10.5" />
  </svg>
);

export const IconCpuCore: React.FC<IconProps> = ({ size = 14, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <rect x="7" y="7" width="10" height="10" rx="2" fill={color} fillOpacity="0.16" />
    <path d="M9.5 4V7M14.5 4V7M9.5 17V20M14.5 17V20M4 9.5H7M4 14.5H7M17 9.5H20M17 14.5H20" />
  </svg>
);

/** 35. 原创双色调几何扩展图标：书脊收折、命令面板、函数曲线、活页审阅、掌握星级、微格时间轴 */
export const IconSidebarToggle: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" fill={color} fillOpacity="0.10" />
    <path d="M9.5 4.5V19.5M6.2 9H7.2M6.2 12H7.2" />
  </svg>
);

export const IconCommandK: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M10 10V6.5C10 5.1 8.9 4 7.5 4C6.1 4 5 5.1 5 6.5C5 7.9 6.1 9 7.5 9H16.5C17.9 9 19 7.9 19 6.5C19 5.1 17.9 4 16.5 4C15.1 4 14 5.1 14 6.5V17.5C14 18.9 15.1 20 16.5 20C17.9 20 19 18.9 19 17.5C19 16.1 17.9 15 16.5 15H7.5C6.1 15 5 16.1 5 17.5C5 18.9 6.1 20 7.5 20C8.9 20 10 18.9 10 17.5V10Z" />
  </svg>
);

export const IconFunctionCurve: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M4 18.5H20M5.5 4V20" strokeOpacity="0.45" />
    <path d="M5.5 16.5C8 8 11 7.2 13 13C14.8 18 17.5 15.2 19.5 6.5" />
    <circle cx="10.2" cy="9.4" r="1.6" fill={color} stroke="none" />
  </svg>
);

export const IconPaperView: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M6 3.5H15L19 7.5V19.5C19 20.1 18.6 20.5 18 20.5H6C5.4 20.5 5 20.1 5 19.5V4.5C5 3.9 5.4 3.5 6 3.5Z" fill={color} fillOpacity="0.12" />
    <path d="M8.5 9H14.5M8.5 12.5H15.5M8.5 16H12.5" />
  </svg>
);

export const IconStarBadge: React.FC<IconProps & { filled?: boolean }> = ({
  size = 15,
  color = 'currentColor',
  filled = false,
  className,
  style,
}) => (
  <svg {...baseProps(size, color, className, style)}>
    <path
      d="M12 3.8L14.4 8.7L19.8 9.5L15.9 13.3L16.8 18.7L12 16.2L7.2 18.7L8.1 13.3L4.2 9.5L9.6 8.7L12 3.8Z"
      fill={filled ? color : 'none'}
      fillOpacity={filled ? 0.9 : 0}
    />
  </svg>
);

export const IconTimelineFlow: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <path d="M4 12H20" strokeOpacity="0.5" />
    <circle cx="6.5" cy="12" r="2.2" fill={color} fillOpacity="0.22" />
    <circle cx="12" cy="12" r="2.2" fill={color} fillOpacity="0.22" />
    <circle cx="17.5" cy="12" r="2.2" fill={color} fillOpacity="0.22" />
    <path d="M6.5 6.5V9.5M12 14.5V17.5M17.5 6.5V9.5" />
  </svg>
);

/** 37. 三维空间与多维曲线立方体图标 */
export const IconDimensionCube: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <polygon points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5" fill={color} fillOpacity="0.08" />
    <path d="M4 7.5L12 12L20 7.5" />
    <path d="M12 12V21" />
    <circle cx="12" cy="12" r="1.6" fill={color} />
  </svg>
);

/** 38. 思维导图分支拓扑图标 */
export const IconMindMap: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <rect x="2.5" y="9.5" width="5.5" height="5" rx="1.4" fill={color} fillOpacity="0.2" />
    <rect x="15.5" y="4" width="6" height="4.2" rx="1.2" />
    <rect x="15.5" y="10" width="6" height="4.2" rx="1.2" />
    <rect x="15.5" y="16" width="6" height="4.2" rx="1.2" />
    <path d="M8 12H12.5M12.5 6.1V18.1M12.5 6.1H15.5M12.5 12H15.5M12.5 18.1H15.5" />
  </svg>
);

export const IconTaskHub: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <rect x="3.5" y="4" width="17" height="16" rx="3" fill={color} fillOpacity="0.12" />
    <path d="M7.5 9H16.5M7.5 13H13.5M7.5 17H11.5" />
    <circle cx="16" cy="16" r="2.2" fill={color} fillOpacity="0.35" />
  </svg>
);

export const IconSearchGlass: React.FC<IconProps> = ({ size = 15, color = 'currentColor', className, style }) => (
  <svg {...baseProps(size, color, className, style)}>
    <circle cx="10.5" cy="10.5" r="6" fill={color} fillOpacity="0.10" />
    <path d="M15 15L20 20" strokeWidth={2} />
  </svg>
);

export const ThemeMiniSwatch: React.FC<{
  bg: string;
  surface: string;
  accent: string;
  border?: string;
}> = ({ bg, surface, accent, border = '#CBD5E1' }) => (
  <svg width="26" height="18" viewBox="0 0 26 18" style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}>
    <rect x="0.75" y="0.75" width="24.5" height="16.5" rx="3.5" fill={bg} stroke={border} strokeWidth="1.2" />
    <rect x="3" y="3" width="9" height="2.4" rx="1.2" fill={accent} />
    <rect x="3" y="7.2" width="9.2" height="7.5" rx="1.8" fill={surface} stroke={border} strokeWidth="0.6" />
    <rect x="13.8" y="7.2" width="9.2" height="7.5" rx="1.8" fill={surface} stroke={border} strokeWidth="0.6" />
  </svg>
);
