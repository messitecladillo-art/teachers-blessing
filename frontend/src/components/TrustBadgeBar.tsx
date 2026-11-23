import React from 'react';
import { VerificationReport } from '../types';
import { IconShieldLock, IconAlertWarn, IconVerifyCheck, IconCrossCircle } from './EduIcons';

interface TrustBadgeBarProps {
  verification?: VerificationReport;
  uncertaintyNote?: string;
}

export const TrustBadgeBar: React.FC<TrustBadgeBarProps> = ({ verification, uncertaintyNote }) => {
  if (!verification) return null;

  const isOk = verification.status === 'verified';
  const isMismatch = verification.status === 'mismatch';

  return (
    <div
      className={isOk ? 'callout-verified' : isMismatch ? 'callout-danger' : 'callout-warn'}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isOk ? (
            <IconShieldLock size={17} color="var(--success)" />
          ) : (
            <IconAlertWarn size={17} color={isMismatch ? 'var(--seal)' : 'var(--warn)'} />
          )}
          <span style={{ fontWeight: 700, fontSize: 13.5, color: isOk ? 'var(--success)' : isMismatch ? 'var(--seal)' : 'var(--warn)' }}>
            {verification.badge}
          </span>
        </div>
        <span className={`stamp-badge ${isOk ? 'stamp-verified' : isMismatch ? 'stamp-seal' : 'stamp-warn'}`}>
          {isOk ? '计算已核对' : '建议人工复核'}
        </span>
      </div>

      {verification.checks && verification.checks.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {verification.checks.map((chk, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 7,
                fontSize: 12.5,
                color: 'var(--ink-secondary)',
                background: 'rgba(255,255,255,0.72)',
                padding: '6px 10px',
                borderRadius: 8,
              }}
            >
              {chk.passed ? (
                <IconVerifyCheck size={15} color="#047857" style={{ marginTop: 2 }} />
              ) : (
                <IconCrossCircle size={15} color="#BE123C" style={{ marginTop: 2 }} />
              )}
              <div>
                <strong>{chk.label}：</strong>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{chk.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {uncertaintyNote && uncertaintyNote !== '无歧义' && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#92400E' }}>
          <strong>边界与复核提示：</strong>
          {uncertaintyNote}
        </div>
      )}
    </div>
  );
};
