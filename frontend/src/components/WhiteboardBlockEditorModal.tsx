import React, { useEffect, useState } from 'react';
import { BoardBlock } from '../types';

export interface BoardEditorPayload {
  op: 'add_block' | 'update_block' | 'add_page';
  page_index: number;
  block_id?: string;
  block_type: 'concept' | 'derivation' | 'example' | 'trap' | 'summary';
  heading: string;
  lines: string[];
  highlight_note: string;
  narration: string;
  teaching_tip: string;
  visual_expr: string;
  roadmap_title?: string;
}

interface WhiteboardBlockEditorModalProps {
  open: boolean;
  mode: 'add_block' | 'edit_block' | 'add_page';
  pageIndex: number;
  initialBlock?: BoardBlock | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: BoardEditorPayload) => void;
}

const BLOCK_TYPE_OPTS: { id: BoardEditorPayload['block_type']; label: string }[] = [
  { id: 'concept', label: '核心概念' },
  { id: 'derivation', label: '推导步骤' },
  { id: 'example', label: '典例演算' },
  { id: 'trap', label: '易错反例' },
  { id: 'summary', label: '课堂小结' },
];

export const WhiteboardBlockEditorModal: React.FC<WhiteboardBlockEditorModalProps> = ({
  open,
  mode,
  pageIndex,
  initialBlock,
  saving,
  onClose,
  onSubmit,
}) => {
  const [blockType, setBlockType] = useState<BoardEditorPayload['block_type']>('concept');
  const [heading, setHeading] = useState('');
  const [linesText, setLinesText] = useState('');
  const [highlightNote, setHighlightNote] = useState('');
  const [narration, setNarration] = useState('');
  const [teachingTip, setTeachingTip] = useState('');
  const [visualExpr, setVisualExpr] = useState('');
  const [roadmapTitle, setRoadmapTitle] = useState('');

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit_block' && initialBlock) {
      setBlockType(initialBlock.block_type || 'derivation');
      setHeading(initialBlock.heading || '');
      setLinesText((initialBlock.lines || []).join('\n'));
      setHighlightNote(initialBlock.highlight_note || '');
      setNarration(initialBlock.narration || '');
      setTeachingTip(initialBlock.teaching_tip || '');
      setVisualExpr(initialBlock.visual_expr || '');
      setRoadmapTitle('');
    } else {
      setBlockType(mode === 'add_page' ? 'concept' : 'derivation');
      setHeading('');
      setLinesText('');
      setHighlightNote('');
      setNarration('');
      setTeachingTip('');
      setVisualExpr('');
      setRoadmapTitle(`扩展板书 · 第 ${pageIndex + 1} 页`);
    }
  }, [open, mode, initialBlock, pageIndex]);

  if (!open) return null;

  const lines = linesText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const canSubmit =
    mode === 'add_page' ? Boolean(roadmapTitle.trim()) : Boolean(heading.trim() || lines.length > 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        style={{ maxWidth: 560, maxHeight: '88vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>
            {mode === 'edit_block' ? '编辑板书块' : mode === 'add_page' ? '新建白板页面' : `新增板书块（第 ${pageIndex} 页）`}
          </h3>
          <button type="button" className="hk-collapse-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'add_page' && (
            <div>
              <label className="field-label">新页面路线图标题</label>
              <input
                className="input"
                value={roadmapTitle}
                onChange={(e) => setRoadmapTitle(e.target.value)}
                placeholder="例如：课堂随堂变式板书"
              />
            </div>
          )}

          <div>
            <label className="field-label">板书语义类型</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {BLOCK_TYPE_OPTS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`btn btn-sm ${blockType === opt.id ? 'btn-primary' : 'btn-surface'}`}
                  onClick={() => setBlockType(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="field-label">板书标题{mode === 'add_page' ? '（可选首块）' : ''}</label>
            <input
              className="input"
              value={heading}
              onChange={(e) => setHeading(e.target.value)}
              placeholder="例如：三、边界极值回代检验"
              data-testid="wb-editor-heading"
            />
          </div>

          <div>
            <label className="field-label">板书要点（每行一条，支持 `$LaTeX$` 公式）</label>
            <textarea
              className="textarea"
              rows={4}
              value={linesText}
              onChange={(e) => setLinesText(e.target.value)}
              placeholder={'1. 先确定定义域 $x > 0$\n2. 求导 $f\'(x)=1 - 1/x$\n3. 列表判断左右符号变化'}
              data-testid="wb-editor-lines"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="field-label">重点提醒标签（可选）</label>
              <input
                className="input"
                value={highlightNote}
                onChange={(e) => setHighlightNote(e.target.value)}
                placeholder="例如：多段单调区间用“和”连接"
              />
            </div>
            <div>
              <label className="field-label">关联函数图像表达式（可选）</label>
              <input
                className="input"
                value={visualExpr}
                onChange={(e) => setVisualExpr(e.target.value)}
                placeholder="例如：x^3 - 3*x^2 + 2"
              />
            </div>
          </div>

          <div>
            <label className="field-label">口语讲解稿 / 字幕脚本（留空则自动根据板书生成自然汉语）</label>
            <textarea
              className="textarea"
              rows={2}
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder="用于「开始讲课」同步口播与底部字幕…"
            />
          </div>

          <div>
            <label className="field-label">教师授课停顿 / 板书提示（教学模式可见）</label>
            <input
              className="input"
              value={teachingTip}
              onChange={(e) => setTeachingTip(e.target.value)}
              placeholder="例如：停顿 3 秒请学生先判断临界点导数符号"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 6 }}>
            <button type="button" className="btn btn-surface btn-sm" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!canSubmit || saving}
              data-testid="wb-editor-submit"
              onClick={() =>
                onSubmit({
                  op: mode === 'edit_block' ? 'update_block' : mode === 'add_page' ? 'add_page' : 'add_block',
                  page_index: pageIndex,
                  block_id: initialBlock?.id,
                  block_type: blockType,
                  heading: heading.trim(),
                  lines,
                  highlight_note: highlightNote.trim(),
                  narration: narration.trim(),
                  teaching_tip: teachingTip.trim(),
                  visual_expr: visualExpr.trim(),
                  roadmap_title: roadmapTitle.trim(),
                })
              }
            >
              {saving ? '保存中…' : mode === 'edit_block' ? '保存修改' : mode === 'add_page' ? '创建新页' : '写入板书'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
