import React, { useState } from 'react';
import {
  IconChevronDown,
  IconChevronRight,
  IconCpuCore,
  IconCrossCircle,
  IconSpinnerOrbit,
  IconVerifyCheck,
} from './EduIcons';

interface AgentStreamTraceProps {
  isStreaming: boolean;
  stageMessage: string;
  thinkingText: string;
  errorMessage?: string;
}

export const AgentStreamTrace: React.FC<AgentStreamTraceProps> = ({
  isStreaming,
  stageMessage,
  thinkingText,
  errorMessage,
}) => {
  const [expanded, setExpanded] = useState(false);

  if (!isStreaming && !thinkingText && !errorMessage) return null;

  return (
    <div className="stream-trace" data-testid="agent-stream-trace">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {errorMessage ? (
            <IconCrossCircle size={15} color="var(--seal)" />
          ) : isStreaming ? (
            <IconSpinnerOrbit size={15} color="var(--accent)" />
          ) : (
            <IconVerifyCheck size={15} color="var(--success)" />
          )}
          <span
            style={{
              fontWeight: 600,
              color: errorMessage ? 'var(--seal)' : 'var(--ink-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {errorMessage || stageMessage || '处理完成'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {isStreaming && (
            <span className="stamp-badge stamp-accent mono-num">处理中</span>
          )}
          {thinkingText && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setExpanded((v) => !v)}
            >
              <IconCpuCore size={13} />
              推导过程 ({thinkingText.length} 字)
              {expanded ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
            </button>
          )}
        </div>
      </div>

      {expanded && thinkingText && <div className="stream-thinking-body">{thinkingText}</div>}
    </div>
  );
};
