import React, { useEffect, useState } from 'react';
import { apiJson, handleSafeDownload, isStaticDemoMode, postSseStream, resolveApiUrl, uploadSourceFile } from '../services/api';
import { ArtifactItem, PptDeck, PptTheme, TeachingTransferPayload } from '../types';
import { AgentStreamTrace } from '../components/AgentStreamTrace';
import { DisciplineCascadePicker } from '../components/DisciplineCascadePicker';
import { MathText } from '../components/MathText';
import {
  IconChevronLeft,
  IconChevronRight,
  IconClockTimer,
  IconCloseX,
  IconDownloadBox,
  IconEditPen,
  IconPaletteSwatch,
  IconShieldLock,
  IconSlideDeck,
  IconStageExpand,
  IconUploadCloud,
  IconVerifyCheck,
  IconVoiceWave,
  IconWandRefine,
  ThemeMiniSwatch,
} from '../components/EduIcons';

interface PptStudioWorkspaceProps {
  transferPayload: TeachingTransferPayload | null;
  onConsumeTransfer: () => void;
  externalDeckId?: string | null;
  onConsumeExternalDeck?: () => void;
  onArtifactsChanged: () => void;
}

const PPT_PRESETS = [
  { label: '高二数学·导数几何意义', domainId: 'math', branch: '初等与高中数学', subject: '高中数学', grade: '高二年级', title: '导数的几何意义与切线求解策略' },
  { label: '概率论·全概率与贝叶斯', domainId: 'math', branch: '概率统计与随机过程', subject: '概率论', grade: '大学数学', title: '全概率公式与贝叶斯逆概率思维' },
  { label: '高中物理·动量守恒定律', domainId: 'physics', branch: '力学与动力学', subject: '高中物理', grade: '高二年级', title: '动量守恒定律实验验证与碰撞模型' },
  { label: '跨学科PBL·传染病Logistic防控', domainId: 'interdisciplinary', branch: '生物医学与公共卫生PBL', subject: '跨学科主题学习 (PBL)', grade: '高中/大学通识', title: 'Logistic种群动力学与公共卫生干预阈值' },
];

const EDITORIAL_THEME_IDS = new Set(['porcelain_daylight', 'emerald_chalkboard', 'warm_academy']);

const ELEMENT_ROLE_ZH: Record<string, string> = {
  title: '主标题',
  subtitle: '副标题',
  kicker: '眉题标签',
  card: '要点卡片',
  body: '正文内容',
  callout: '重点提示',
  step: '步骤卡片',
  metric: '关键指标',
  caption: '图注说明',
  footer: '页脚注释',
};

function getReadableElementLabel(
  textId: string,
  items: { id: string; role: string; text: string }[]
): string {
  const hit = items.find((x) => x.id === textId);
  if (hit) {
    return ELEMENT_ROLE_ZH[hit.role] || '画布文本';
  }
  if (textId.includes('title')) return '主标题';
  if (textId.includes('sub')) return '副标题';
  if (textId.includes('card')) return '要点卡片';
  return '画布文本';
}

export const PptStudioWorkspace: React.FC<PptStudioWorkspaceProps> = ({
  transferPayload,
  onConsumeTransfer,
  externalDeckId,
  onConsumeExternalDeck,
  onArtifactsChanged,
}) => {
  const [themes, setThemes] = useState<PptTheme[]>([]);
  const [voices, setVoices] = useState<{ id: string; label: string }[]>([]);
  const [decks, setDecks] = useState<PptDeck[]>([]);
  const [activeDeck, setActiveDeck] = useState<PptDeck | null>(null);
  const [loadingDecks, setLoadingDecks] = useState(true);
  const [showExtraThemes, setShowExtraThemes] = useState(false);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [inspectorTab, setInspectorTab] = useState<'text' | 'notes' | 'regen'>('text');

  // Generation form state
  const [domainId, setDomainId] = useState('math');
  const [branch, setBranch] = useState('初等与高中数学');
  const [title, setTitle] = useState('导数的几何意义与切线求解策略');
  const [subject, setSubject] = useState('高中数学');
  const [gradeLevel, setGradeLevel] = useState('高二年级');
  const [selectedTheme, setSelectedTheme] = useState('porcelain_daylight');
  const [slideCount, setSlideCount] = useState(6);
  const [sourceMaterial, setSourceMaterial] = useState('');
  const [uploadedName, setUploadedName] = useState('');
  const [focusStage, setFocusStage] = useState(false);

  // Stream & edit state
  const [isStreaming, setIsStreaming] = useState(false);
  const [stageMsg, setStageMsg] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Inline SVG text editing state
  const [selectedTextId, setSelectedTextId] = useState<string>('');
  const [editTextValue, setEditTextValue] = useState<string>('');
  const [editNotesValue, setEditNotesValue] = useState<string>('');
  const [fontScale, setFontScale] = useState<number>(1.0);
  const [savingSlide, setSavingSlide] = useState(false);
  const [switchingTheme, setSwitchingTheme] = useState(false);
  const [regenInstruction, setRegenInstruction] = useState('强化典型例题易错提醒，并用直观比喻精简投影文字');
  const [regenerating, setRegenerating] = useState(false);

  // TTS & Presenter view
  const [selectedVoice, setSelectedVoice] = useState('zh-CN-XiaoxiaoNeural');
  const [narrating, setNarrating] = useState(false);
  const [audioArtifact, setAudioArtifact] = useState<ArtifactItem | null>(null);
  const [presenterMode, setPresenterMode] = useState(false);
  const [timerPaused, setTimerPaused] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [toastMsg, setToastMsg] = useState('');

  const loadInitial = async () => {
    try {
      const [thRes, dkRes] = await Promise.all([
        apiJson<{ themes: PptTheme[]; voices: { id: string; label: string }[] }>('/api/ppt/themes'),
        apiJson<{ decks: PptDeck[] }>('/api/ppt/decks'),
      ]);
      setThemes(thRes.themes);
      setVoices(thRes.voices);
      setDecks(dkRes.decks);
      if (!activeDeck && dkRes.decks.length > 0) {
        setActiveDeck(dkRes.decks[0]);
        setSelectedTheme(dkRes.decks[0].theme_id || 'porcelain_daylight');
        setActiveSlideIdx(0);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载课件工作台数据失败');
    } finally {
      setLoadingDecks(false);
    }
  };

  useEffect(() => {
    void loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!externalDeckId) return;
    apiJson<{ decks: PptDeck[] }>('/api/ppt/decks')
      .then((dkRes) => {
        setDecks(dkRes.decks);
        const found = dkRes.decks.find((d) => d.id === externalDeckId);
        if (found) {
          setActiveDeck(found);
          setSelectedTheme(found.theme_id || 'porcelain_daylight');
          setActiveSlideIdx(0);
          setAudioArtifact(null);
          setToastMsg('');
          setErrorMsg('');
        }
      })
      .catch((err) => {
        setErrorMsg(err instanceof Error ? err.message : '加载指定课件失败');
      })
      .finally(() => onConsumeExternalDeck?.());
  }, [externalDeckId, onConsumeExternalDeck]);

  useEffect(() => {
    if (transferPayload && transferPayload.target_tab === 'ppt') {
      setTitle(transferPayload.title);
      setSubject(transferPayload.subject);
      setGradeLevel(transferPayload.grade_level);
      if (transferPayload.domain) setDomainId(transferPayload.domain);
      if (transferPayload.branch) setBranch(transferPayload.branch);
      setSourceMaterial(transferPayload.context_summary);
      setErrorMsg('');
      setToastMsg('');
      onConsumeTransfer();
    }
  }, [transferPayload, onConsumeTransfer]);

  const currentSlide = activeDeck?.slides[activeSlideIdx] || null;

  useEffect(() => {
    if (!currentSlide) return;
    setEditNotesValue(currentSlide.speaker_notes || '');
    const firstEditable = currentSlide.editable_texts.find((t) => t.role === 'title') || currentSlide.editable_texts[0];
    if (firstEditable) {
      setSelectedTextId(firstEditable.id);
      setEditTextValue(firstEditable.text);
    } else {
      setSelectedTextId('');
      setEditTextValue('');
    }
    setFontScale(1.0);
  }, [activeDeck?.id, activeSlideIdx, currentSlide]);

  useEffect(() => {
    if (!presenterMode || !activeDeck) return;
    const timer = window.setInterval(() => {
      if (!timerPaused) setElapsedSec((s) => s + 1);
    }, 1000);
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() || '';
      const isTypingField =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(target?.isContentEditable);
      const isInteractiveButton =
        tag === 'button' || tag === 'a' || Boolean(target?.closest('button, a'));

      if (isTypingField) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setPresenterMode(false);
        }
        return;
      }

      if (
        e.key === 'ArrowRight' ||
        e.key === 'ArrowDown' ||
        e.key === 'PageDown' ||
        (e.key === ' ' && !isInteractiveButton)
      ) {
        e.preventDefault();
        setActiveSlideIdx((i) => Math.min(activeDeck.slides.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        setActiveSlideIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setActiveSlideIdx(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setActiveSlideIdx(Math.max(0, activeDeck.slides.length - 1));
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        setTimerPaused((p) => !p);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setPresenterMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [presenterMode, activeDeck, timerPaused]);

  useEffect(() => {
    if (presenterMode || !activeDeck) return;
    const onStageKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() || '';
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(target?.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveSlideIdx((i) => Math.min(activeDeck.slides.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setActiveSlideIdx((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onStageKey);
    return () => window.removeEventListener('keydown', onStageKey);
  }, [presenterMode, activeDeck]);

  const handleBrowserSpeak = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(
        editNotesValue ||
          activeDeck?.slides[activeSlideIdx]?.speaker_notes ||
          activeDeck?.title ||
          '试讲示范文稿'
      );
      utter.lang = 'zh-CN';
      window.speechSynthesis.speak(utter);
    }
  };

  const handleUploadSource = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg('');
    try {
      const res = await uploadSourceFile(file);
      setUploadedName(res.filename);
      setSourceMaterial(res.markdown_full);
      setToastMsg(`已解析参考资料《${res.filename}》（${res.char_count} 字符）`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '文档上传失败');
    }
  };

  const handleGenerateDeck = async () => {
    if (!title.trim() || isStreaming) return;
    setIsStreaming(true);
    setStageMsg('正在规划课件结构与版式…');
    setThinkingText('');
    setErrorMsg('');
    setToastMsg('');
    setAudioArtifact(null);

    try {
      await postSseStream<{ deck: PptDeck; artifact: ArtifactItem }>(
        '/api/ppt/generate',
        {
          title,
          subject,
          grade_level: gradeLevel,
          domain: domainId,
          branch,
          theme_id: selectedTheme,
          slide_count: slideCount,
          source_material: sourceMaterial,
        },
        {
          onStage: (_, msg) => setStageMsg(msg),
          onThinking: (d) => setThinkingText((p) => p + d),
          onResult: (data) => {
            setActiveDeck(data.deck);
            setActiveSlideIdx(0);
            setDecks((prev) => [data.deck, ...prev]);
            setToastMsg(`课件已生成，共 ${data.deck.slides.length} 页，可在右侧直接修改文本与备注。`);
            onArtifactsChanged();
          },
          onError: (msg) => setErrorMsg(msg),
        }
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '生成失败');
    } finally {
      setIsStreaming(false);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!currentSlide) return;
    const target = e.target as Element | null;
    const textNode = target?.closest('text[id]');
    if (!textNode) return;
    const tid = textNode.getAttribute('id') || '';
    const found = currentSlide.editable_texts.find((item) => item.id === tid);
    if (found) {
      setSelectedTextId(found.id);
      setEditTextValue(found.text);
      setFontScale(1.0);
      setInspectorTab('text');
    }
  };

  const handleSaveInlineEdit = async () => {
    if (!activeDeck || !currentSlide) return;
    setSavingSlide(true);
    setToastMsg('');
    setErrorMsg('');
    try {
      const edits: Record<string, string> = {};
      if (selectedTextId) {
        edits[selectedTextId] = editTextValue;
      }
      const res = await apiJson<{ slides: PptDeck['slides']; pptx_audit: PptDeck['pptx_audit']; edit_count: number }>(
        `/api/ppt/decks/${activeDeck.id}/slides/${currentSlide.slide_number}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            edits,
            speaker_notes: editNotesValue,
            font_scale: fontScale,
          }),
        }
      );
      const updatedDeck = { ...activeDeck, slides: res.slides, pptx_audit: res.pptx_audit, edit_count: res.edit_count };
      setActiveDeck(updatedDeck);
      setDecks((prev) => prev.map((d) => (d.id === updatedDeck.id ? updatedDeck : d)));
      setToastMsg(`第 ${currentSlide.slide_number} 页修改已保存。`);
      onArtifactsChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存本页修改失败');
    } finally {
      setSavingSlide(false);
    }
  };

  const handleSwitchTheme = async (themeId: string) => {
    if (!activeDeck || switchingTheme) return;
    setSwitchingTheme(true);
    setToastMsg('');
    setErrorMsg('');
    try {
      const res = await apiJson<{ theme_id: string; slides: PptDeck['slides']; pptx_audit: PptDeck['pptx_audit'] }>(
        `/api/ppt/decks/${activeDeck.id}/theme`,
        { method: 'POST', body: JSON.stringify({ theme_id: themeId }) }
      );
      setSelectedTheme(res.theme_id);
      const updated = { ...activeDeck, theme_id: res.theme_id, slides: res.slides, pptx_audit: res.pptx_audit };
      setActiveDeck(updated);
      setDecks((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setToastMsg('主题已切换并更新课件文件。');
      onArtifactsChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '切换主题失败');
    } finally {
      setSwitchingTheme(false);
    }
  };

  const handleRegenerateSlide = async () => {
    if (!activeDeck || !currentSlide || !regenInstruction.trim()) return;
    setRegenerating(true);
    setToastMsg('');
    setErrorMsg('');
    try {
      const res = await apiJson<{ slides: PptDeck['slides']; pptx_audit: PptDeck['pptx_audit'] }>(
        `/api/ppt/decks/${activeDeck.id}/slides/${currentSlide.slide_number}/regenerate`,
        { method: 'POST', body: JSON.stringify({ instruction: regenInstruction }) }
      );
      const updated = { ...activeDeck, slides: res.slides, pptx_audit: res.pptx_audit };
      setActiveDeck(updated);
      setDecks((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setToastMsg(`第 ${currentSlide.slide_number} 页已更新。`);
      onArtifactsChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '单页重构失败');
    } finally {
      setRegenerating(false);
    }
  };

  const handleSynthesizeNarration = async () => {
    if (!activeDeck || narrating) return;
    setNarrating(true);
    setToastMsg('');
    setErrorMsg('');
    try {
      const res = await apiJson<{ audio_artifact: ArtifactItem }>(
        `/api/ppt/decks/${activeDeck.id}/narrate`,
        { method: 'POST', body: JSON.stringify({ voice: selectedVoice }) }
      );
      setAudioArtifact(res.audio_artifact);
      const updatedDeck = { ...activeDeck, audio_artifact_id: res.audio_artifact.id };
      setActiveDeck(updatedDeck);
      setDecks((prev) => prev.map((d) => (d.id === updatedDeck.id ? updatedDeck : d)));
      setToastMsg('试讲示范语音已合成完成。');
      onArtifactsChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '语音合成失败');
    } finally {
      setNarrating(false);
    }
  };

  const downloadPptxUrl = activeDeck?.pptx_artifact_id ? `/api/artifacts/${activeDeck.pptx_artifact_id}/download` : '';
  const audioUrl = audioArtifact?.download_url || (activeDeck?.audio_artifact_id ? `/api/artifacts/${activeDeck.audio_artifact_id}/download` : '');

  return (
    <div className="desk-split" style={focusStage ? { gridTemplateColumns: '1fr' } : undefined}>
      {/* Left Intent Column */}
      {!focusStage && (
      <div className="pane-intent">
        <div className="pane-intent-scroll">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 className="serif-heading" style={{ margin: 0, fontSize: 16.5 }}>课件生成设定</h2>
              <span className="stamp-badge stamp-accent">DrawingML</span>
            </div>
            <div className="preset-strip">
              {PPT_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="preset-chip"
                  onClick={() => {
                    setDomainId(p.domainId);
                    setBranch(p.branch);
                    setSubject(p.subject);
                    setGradeLevel(p.grade);
                    setTitle(p.title);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pane-section-div">
            <label className="field-label">课件课题</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="ppt-title-input" />
          </div>

          <DisciplineCascadePicker
            domainId={domainId}
            branch={branch}
            subject={subject}
            gradeLevel={gradeLevel}
            onChange={(next) => {
              setDomainId(next.domainId);
              setBranch(next.branch);
              setSubject(next.subject);
              setGradeLevel(next.gradeLevel);
            }}
          />

          <div>
            <label className="field-label">页数</label>
            <select className="select" value={slideCount} onChange={(e) => setSlideCount(Number(e.target.value))}>
              <option value={5}>5 页 · 精炼微格</option>
              <option value={6}>6 页 · 标准试讲</option>
              <option value={7}>7 页 · 数形增强</option>
              <option value={8}>8 页 · 完整新授</option>
            </select>
          </div>

          <div>
            <label className="field-label">参考资料（文档 / 课件 / LaTeX / 压缩包）</label>
            <label className="btn btn-surface btn-sm" style={{ width: '100%', cursor: 'pointer' }}>
              <IconUploadCloud size={14} />
              {uploadedName ? `已导入：${uploadedName}` : '上传参考资料'}
              <input type="file" hidden accept=".pdf,.docx,.pptx,.tex,.latex,.html,.zip,.md,.txt" onChange={handleUploadSource} />
            </label>
            {sourceMaterial && (
              <div className="callout-pedagogy" style={{ fontSize: 11.5, marginTop: 6, padding: '6px 10px' }}>
                已就绪上下文（{sourceMaterial.length} 字）
              </div>
            )}
          </div>

          <div className="pane-section-div">
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, color: 'var(--ink-muted)' }}>
              已编译课件 ({decks.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 170, overflowY: 'auto' }}>
              {decks.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`spine-item ${activeDeck?.id === d.id ? 'active' : ''}`}
                  style={{ padding: '7px 10px' }}
                  onClick={() => {
                    setActiveDeck(d);
                    setSelectedTheme(d.theme_id || 'porcelain_daylight');
                    setActiveSlideIdx(0);
                    setAudioArtifact(null);
                    setToastMsg('');
                    setErrorMsg('');
                  }}
                >
                  <span className="spine-item-text" style={{ fontSize: 12.5 }}>{d.title}</span>{' '}
                  <span className="spine-count">{d.slides.length} 页</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pane-sticky-cta">
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', padding: '9px 14px' }}
            onClick={handleGenerateDeck}
            disabled={isStreaming || !title.trim()}
            data-testid="btn-generate-ppt"
          >
            <IconSlideDeck size={15} />
            {isStreaming ? '生成中…' : '生成课件'}
          </button>
        </div>
      </div>
      )}

      {/* Right Stage: Keynote Filmstrip + 16:9 Stage + Tabbed Inspector */}
      <div className="pane-stage">
        <div className="stage-inner" style={{ maxWidth: 1120 }}>
          <AgentStreamTrace isStreaming={isStreaming} stageMessage={stageMsg} thinkingText={thinkingText} errorMessage={errorMsg} />

          {!activeDeck && loadingDecks && (
            <div className="paper-folio" style={{ minHeight: 360, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>正在调取原生 PPT 演播室档案…</div>
              <div style={{ height: 26, width: '55%', background: 'var(--bg-subtle)', borderRadius: 4 }} />
              <div style={{ aspectRatio: '16 / 9', width: '100%', background: 'var(--bg-subtle)', borderRadius: 6 }} />
            </div>
          )}

          {activeDeck && currentSlide && (
            <>
              {/* Audit & Theme Header Bar */}
              <div className="folio-strip" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="serif-heading" style={{ fontWeight: 600, fontSize: 18.5 }}>
                      <MathText inline text={activeDeck.title} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4, fontSize: 12, color: 'var(--ink-muted)' }}>
                      <span className="stamp-badge stamp-verified">
                        <IconShieldLock size={12} /> 版式已核对
                      </span>
                      <span className="mono-num">
                        共 {activeDeck.slides.length} 页 · 点击画布文字可直接修改
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-surface btn-sm"
                      onClick={() => setFocusStage((f) => !f)}
                      data-testid="btn-toggle-focus-stage"
                    >
                      <IconStageExpand size={14} /> {focusStage ? '展开左侧设置' : '收起侧栏'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-surface btn-sm"
                      onClick={() => {
                        setElapsedSec(0);
                        setTimerPaused(false);
                        setPresenterMode(true);
                      }}
                      data-testid="btn-presenter-mode"
                    >
                      <IconStageExpand size={14} /> 试讲计时
                    </button>
                    {downloadPptxUrl && (
                      <a
                        href={resolveApiUrl(downloadPptxUrl)}
                        download
                        onClick={(e) => handleSafeDownload(e, downloadPptxUrl, `${activeDeck?.title || '演示课件'}.pptx`)}
                        className="btn btn-primary btn-sm"
                        style={{ textDecoration: 'none' }}
                        data-testid="btn-download-pptx"
                      >
                        <IconDownloadBox size={14} /> 导出课件
                      </a>
                    )}
                  </div>
                </div>

                {/* Theme Palette Selector */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingTop: 8, borderTop: '1px solid var(--border-hairline)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)' }}>
                    <IconPaletteSwatch size={14} color="var(--accent)" />
                    幻灯片视觉主题：
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {themes
                      .filter((t) => showExtraThemes || EDITORIAL_THEME_IDS.has(t.id) || t.id === activeDeck.theme_id)
                      .map((t) => {
                        const active = activeDeck.theme_id === t.id;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            disabled={switchingTheme}
                            onClick={() => {
                              setSelectedTheme(t.id);
                              handleSwitchTheme(t.id);
                            }}
                            className={`btn btn-sm ${active ? 'btn-primary' : 'btn-surface'}`}
                            data-testid={`theme-btn-${t.id}`}
                          >
                            <ThemeMiniSwatch bg={t.bg_primary} surface={t.surface} accent={t.accent} border={t.border || '#CBD5E1'} />
                            {t.short_name}
                          </button>
                        );
                      })}
                    {themes.length > 3 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 11.5 }}
                        onClick={() => setShowExtraThemes((v) => !v)}
                        data-testid="btn-toggle-extra-themes"
                      >
                        {showExtraThemes ? '收起配色' : '更多配色'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {toastMsg && (
                <div className="callout-verified" style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IconVerifyCheck size={15} color="var(--success)" /> {toastMsg}
                </div>
              )}

              {/* Keynote-style Left Vertical Filmstrip + 16:9 Stage */}
              <div className="ppt-stage-layout">
                <div className="slide-filmstrip-vertical" aria-label="幻灯片页序缩略图">
                  {activeDeck.slides.map((sl, idx) => (
                    <button
                      key={sl.slide_number}
                      type="button"
                      className={`slide-thumb ${idx === activeSlideIdx ? 'active' : ''}`}
                      onClick={() => setActiveSlideIdx(idx)}
                      data-testid={`slide-thumb-${idx + 1}`}
                    >
                      <div className="slide-thumb-svg" dangerouslySetInnerHTML={{ __html: sl.svg_code }} />
                      <div className="slide-thumb-label">
                        <span className="mono-num">{sl.slide_number}.</span> <MathText inline text={sl.title} />
                      </div>
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--ink-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <IconEditPen size={13} color="var(--accent)" />
                      {selectedTextId ? (
                        <>
                          已选中 <span className="stamp-badge stamp-accent">{getReadableElementLabel(selectedTextId, currentSlide.editable_texts)}</span> — 已同步至图层文本编辑框
                        </>
                      ) : (
                        '点击画布中任意文字，即可原地高亮选中并编辑'
                      )}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-surface btn-sm"
                        aria-label="上一页"
                        disabled={activeSlideIdx === 0}
                        onClick={() => setActiveSlideIdx((i) => Math.max(0, i - 1))}
                      >
                        <IconChevronLeft size={14} />
                      </button>
                      <span className="mono-num" style={{ fontSize: 12.5, fontWeight: 700 }}>
                        {activeSlideIdx + 1} / {activeDeck.slides.length}
                      </span>
                      <button
                        type="button"
                        className="btn btn-surface btn-sm"
                        aria-label="下一页"
                        disabled={activeSlideIdx >= activeDeck.slides.length - 1}
                        onClick={() => setActiveSlideIdx((i) => Math.min(activeDeck.slides.length - 1, i + 1))}
                      >
                        <IconChevronRight size={14} />
                      </button>
                    </div>
                  </div>

                  <div
                    className="slide-stage-frame"
                    onClick={handleCanvasClick}
                    data-testid="ppt-svg-stage"
                    dangerouslySetInnerHTML={{ __html: currentSlide.svg_code }}
                  />
                </div>
              </div>

              {/* Compact Tabbed Slide Inspector */}
              <div className="paper-folio" style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingBottom: 12, borderBottom: '1px solid var(--border-hairline)', marginBottom: 14 }}>
                  <div className="seg-switch">
                    <button
                      type="button"
                      className={`seg-switch-btn ${inspectorTab === 'text' ? 'active' : ''}`}
                      onClick={() => setInspectorTab('text')}
                    >
                      画布文字与排版（第 {currentSlide.slide_number} 页）
                    </button>
                    <button
                      type="button"
                      className={`seg-switch-btn ${inspectorTab === 'notes' ? 'active' : ''}`}
                      onClick={() => setInspectorTab('notes')}
                    >
                      试讲逐字稿 & 语音合成
                    </button>
                    <button
                      type="button"
                      className={`seg-switch-btn ${inspectorTab === 'regen' ? 'active' : ''}`}
                      onClick={() => setInspectorTab('regen')}
                    >
                      AI 单页结构重构
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={savingSlide}
                    onClick={handleSaveInlineEdit}
                    data-testid="btn-apply-slide-edit"
                  >
                    {savingSlide ? '保存中…' : '保存本页修改'}
                  </button>
                </div>

                {inspectorTab === 'text' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(280px, 1.4fr)', gap: 14 }}>
                    <div>
                      <label className="field-label">画布内可选文本图层 ({currentSlide.editable_texts.length})</label>
                      <select
                        className="select"
                        value={selectedTextId}
                        onChange={(e) => {
                          const tid = e.target.value;
                          setSelectedTextId(tid);
                          const f = currentSlide.editable_texts.find((x) => x.id === tid);
                          setEditTextValue(f?.text || '');
                          setFontScale(1.0);
                        }}
                      >
                        {currentSlide.editable_texts.map((item) => (
                          <option key={item.id} value={item.id}>
                            [{ELEMENT_ROLE_ZH[item.role] || '文本'}] {item.text.replace(/\n/g, ' ').slice(0, 34)}
                          </option>
                        ))}
                      </select>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12 }}>
                        字号微调：
                        {[0.9, 1.0, 1.1].map((sc) => (
                          <button
                            key={sc}
                            type="button"
                            className={`btn btn-sm ${fontScale === sc ? 'btn-primary' : 'btn-surface'}`}
                            onClick={() => setFontScale(sc)}
                          >
                            {sc}x
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="field-label">编辑文本内容（支持自动避头点折行）</label>
                      <textarea
                        className="textarea"
                        rows={3}
                        value={editTextValue}
                        onChange={(e) => setEditTextValue(e.target.value)}
                        data-testid="ppt-inline-text-editor"
                      />
                    </div>
                  </div>
                )}

                {inspectorTab === 'notes' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <textarea
                      className="textarea"
                      rows={3}
                      value={editNotesValue}
                      onChange={(e) => setEditNotesValue(e.target.value)}
                      placeholder="编写该页试讲逐字稿（同步写入 PPTX 演讲者备注与配音引擎）…"
                    />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <select className="select" style={{ maxWidth: 260 }} value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)}>
                        {voices.map((v) => (
                          <option key={v.id} value={v.id}>{v.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-surface btn-sm"
                        onClick={handleSynthesizeNarration}
                        disabled={narrating}
                        data-testid="btn-synthesize-tts"
                      >
                        <IconVoiceWave size={14} color="var(--accent)" />
                        {narrating ? '合成中…' : '生成试讲配音'}
                      </button>
                      {isStaticDemoMode() && (
                        <button
                          type="button"
                          className="btn btn-surface btn-sm"
                          onClick={handleBrowserSpeak}
                          data-testid="btn-browser-tts-preview"
                        >
                          试听浏览器朗读
                        </button>
                      )}
                    </div>
                    {audioUrl && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-subtle)', padding: '8px 10px', borderRadius: 8 }}>
                        {!isStaticDemoMode() && (
                          <audio key={audioUrl} controls preload="metadata" src={resolveApiUrl(audioUrl)} style={{ flex: 1, height: 34 }} />
                        )}
                        <a
                          href={resolveApiUrl(audioUrl)}
                          download
                          onClick={(e) =>
                            handleSafeDownload(
                              e,
                              audioUrl,
                              audioArtifact?.filename || `${activeDeck?.title || '试讲配音'}.mp3`
                            )
                          }
                          className="btn btn-surface btn-sm"
                          style={{ textDecoration: 'none' }}
                        >
                          <IconDownloadBox size={13} /> 下载音频
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {inspectorTab === 'regen' && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      className="input"
                      value={regenInstruction}
                      onChange={(e) => setRegenInstruction(e.target.value)}
                      placeholder="输入对当前页的修改要求…"
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={regenerating}
                      onClick={handleRegenerateSlide}
                    >
                      <IconWandRefine size={13} /> {regenerating ? '更新中…' : '重写本页'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Immersive Presenter Mode */}
      {presenterMode && activeDeck && currentSlide && (
        <div className="modal-backdrop" onClick={() => setPresenterMode(false)} data-testid="presenter-modal">
          <div
            className="modal-panel"
            style={{ width: 'min(1380px, 97vw)', background: '#111916', color: '#F4F1EA', borderColor: '#253831' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span className="stamp-badge stamp-accent">试讲计时视图</span>
                <span className="mono-num" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 700 }}>
                  <IconClockTimer size={16} color="#8FD3B8" /> {String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:{String(elapsedSec % 60).padStart(2, '0')}
                </span>
                <button type="button" className="btn btn-surface btn-sm" onClick={() => setTimerPaused((p) => !p)}>
                  {timerPaused ? '继续' : '暂停'}
                </button>
                <button type="button" className="btn btn-surface btn-sm" onClick={() => setElapsedSec(0)}>
                  归零
                </button>
                <span className="mono-num" style={{ fontSize: 12.5, opacity: 0.78 }}>
                  {activeSlideIdx + 1} / {activeDeck.slides.length} · ← / → 键翻页
                </span>
              </div>
              <button type="button" className="btn btn-surface btn-sm" aria-label="退出试讲" onClick={() => setPresenterMode(false)}>
                <IconCloseX size={15} /> 退出试讲
              </button>
            </div>

            <div className="presenter-grid">
              <div className="slide-stage-frame" dangerouslySetInnerHTML={{ __html: currentSlide.svg_code }} />
              <div style={{ background: '#192622', padding: 20, borderRadius: 12, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14, border: '1px solid #2A3F38' }}>
                <div>
                  <div style={{ fontSize: 11.5, color: '#8FD3B8', marginBottom: 8, fontWeight: 700 }}>试讲提词器 / 演讲者备注</div>
                  <div style={{ fontSize: 15.5, lineHeight: 1.82, color: '#F4F1EA', whiteSpace: 'pre-wrap' }}>
                    <MathText text={currentSlide.speaker_notes} />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-surface btn-sm"
                    disabled={activeSlideIdx === 0}
                    onClick={() => setActiveSlideIdx((i) => Math.max(0, i - 1))}
                  >
                    <IconChevronLeft size={14} /> 上一页
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={activeSlideIdx >= activeDeck.slides.length - 1}
                    onClick={() => setActiveSlideIdx((i) => Math.min(activeDeck.slides.length - 1, i + 1))}
                  >
                    下一页 <IconChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
