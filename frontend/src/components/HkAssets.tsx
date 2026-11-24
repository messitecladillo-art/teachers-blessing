import React from 'react';
import { assetUrl } from '../utils/assets';

export type HkIconName =
  | 'home'
  | 'courses'
  | 'calendar'
  | 'history'
  | 'market'
  | 'kb'
  | 'whiteboard'
  | 'cheatsheet'
  | 'quiz'
  | 'visual'
  | 'concept'
  | 'solve'
  | 'lesson'
  | 'analytics';

export const HkIcon: React.FC<{
  name: HkIconName;
  size?: number;
  className?: string;
  alt?: string;
}> = ({ name, size = 18, className = '', alt = '' }) => (
  <img
    src={assetUrl(`/assets/hk/icon_${name}.png`)}
    alt={alt}
    aria-hidden={alt ? undefined : true}
    decoding="async"
    width={size}
    height={size}
    draggable={false}
    className={`hk-generated-icon ${className}`.trim()}
    style={{
      width: size,
      height: size,
      objectFit: 'contain',
      display: 'inline-block',
      flexShrink: 0,
      userSelect: 'none',
    }}
  />
);

export const HkBrandLogo: React.FC<{ size?: number }> = ({ size = 28 }) => (
  <img
    src={assetUrl('/assets/hk/brand_logo.png')}
    alt="知学工作台徽标"
    decoding="async"
    width={size}
    height={size}
    draggable={false}
    style={{
      width: size,
      height: size,
      objectFit: 'contain',
      display: 'block',
      flexShrink: 0,
      userSelect: 'none',
    }}
  />
);

export const HkMascot: React.FC<{
  state?: 'welcome' | 'thinking';
  size?: number;
  className?: string;
}> = ({ state = 'welcome', size = 54, className = '' }) => (
  <img
    src={assetUrl(`/assets/hk/mascot_${state}.png`)}
    alt={state === 'thinking' ? '思考中的小知' : '小知学者'}
    decoding="async"
    width={size}
    height={size}
    draggable={false}
    className={`hk-mascot-float ${className}`.trim()}
    style={{
      width: size,
      height: size,
      objectFit: 'contain',
      display: 'inline-block',
      verticalAlign: 'middle',
      flexShrink: 0,
      userSelect: 'none',
    }}
  />
);

export const HkUploadBadge: React.FC<{ size?: number }> = ({ size = 56 }) => (
  <img
    src={assetUrl('/assets/hk/upload_files_badge.png')}
    alt="课程资料卡片组"
    decoding="async"
    width={size}
    height={size}
    draggable={false}
    style={{
      width: size,
      height: size,
      objectFit: 'contain',
      display: 'block',
      flexShrink: 0,
      userSelect: 'none',
    }}
  />
);

export const HkScholarAvatar: React.FC<{ size?: number }> = ({ size = 32 }) => (
  <img
    src={assetUrl('/assets/hk/avatar_scholar.png')}
    alt="个人头像"
    decoding="async"
    width={size}
    height={size}
    draggable={false}
    style={{
      width: size,
      height: size,
      borderRadius: '999px',
      objectFit: 'cover',
      display: 'block',
      flexShrink: 0,
      border: '1.5px solid #E5E7EB',
      userSelect: 'none',
    }}
  />
);
