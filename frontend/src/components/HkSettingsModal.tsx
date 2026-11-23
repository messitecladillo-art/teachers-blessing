import React, { useEffect, useState } from 'react';
import { apiJson } from '../services/api';
import { LLMStatusSummary, LearnerWeakTopic, TeacherPreferences } from '../types';
import { HkScholarAvatar } from './HkAssets';

interface HkSettingsModalProps {
  open: boolean;
  initialTab?: 'general' | 'memory' | 'model';
  llmStatus: LLMStatusSummary | null;
  onClose: () => void;
  onLlmUpdated: (s: LLMStatusSummary) => void;
  onStartRemediationExam: (examId: string) => void;
}

export const HkSettingsModal: React.FC<HkSettingsModalProps> = ({
  open,
  initialTab = 'general',
  llmStatus,
  onClose,
  onLlmUpdated,
  onStartRemediationExam,
}) => {
  const [tab, setTab] = useState<'general' | 'memory' | 'model'>(initialTab);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [weakTopics, setWeakTopics] = useState<LearnerWeakTopic[]>([]);
  const [prefs, setPrefs] = useState<TeacherPreferences>({
    preferred_subject: '高中数学',
    preferred_grade: '高二年级',
    preferred_lesson_type: '45分钟新授课',
    preferred_slide_count: '6',
    preferred_theme: 'porcelain_daylight',
    preferred_difficulty: '均衡梯度',
    memory_enabled: 'true',
  });
  const [protocol, setProtocol] = useState('anthropic');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com/anthropic');
  const [model, setModel] = useState('deepseek-reasoner');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [makingQuiz, setMakingQuiz] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => {
    if (!open) return;
    apiJson<{ weak_topics: LearnerWeakTopic[]; preferences: TeacherPreferences }>('/api/agent/memory')
      .then((res) => {
        setWeakTopics(res.weak_topics || []);
        if (res.preferences) {
          setPrefs(res.preferences);
          setMemoryEnabled(String(res.preferences.memory_enabled ?? 'true').toLowerCase() !== 'false');
        }
      })
      .catch(() => {});
    if (llmStatus) {
      setProtocol(llmStatus.protocol);
      setModel(llmStatus.model);
    }
  }, [open, llmStatus]);

  if (!open) return null;

  const savePrefs = async (next: TeacherPreferences) => {
    setSaving(true);
    setNotice('');
    try {
      await apiJson('/api/agent/memory/preferences', {
        method: 'PUT',
        body: JSON.stringify({ preferences: next }),
      });
      setNotice('偏好已保存');
    } catch {
      setNotice('保存遇到问题');
    } finally {
      setSaving(false);
    }
  };

  const saveModelConfig = async () => {
    setSaving(true);
    setNotice('');
    try {
      const res = await apiJson<{ llm: LLMStatusSummary }>('/api/system/config', {
        method: 'POST',
        body: JSON.stringify({
          protocol,
          base_url: baseUrl,
          model,
          api_key: apiKey.trim() || undefined,
        }),
      });
      onLlmUpdated(res.llm);
      setApiKey('');
      setNotice('服务参数已更新');
    } catch {
      setNotice('更新失败');
    } finally {
      setSaving(false);
    }
  };

  const handleRemediationQuiz = async () => {
    setMakingQuiz(true);
    setNotice('');
    try {
      const res = await apiJson<{ exam_record: { id: string } }>('/api/agent/memory/remediation-quiz', {
        method: 'POST',
        body: JSON.stringify({ topics: weakTopics.slice(0, 3).map((w) => w.topic_tag), count: 4 }),
      });
      if (res.exam_record?.id) {
        onClose();
        onStartRemediationExam(res.exam_record.id);
      }
    } catch {
      setNotice('强化小测生成失败，请稍后重试');
    } finally {
      setMakingQuiz(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="hk-settings-split" onClick={(e) => e.stopPropagation()}>
        <div className="hk-settings-nav">
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#6b7280', padding: '0 8px 4px' }}>账户</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px 14px', borderBottom: '1px solid #eef0f3', marginBottom: 8 }}>
            <HkScholarAvatar size={36} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#181a1f' }}>知学研习者</div>
              <div style={{ fontSize: 11.5, color: '#6b7280' }}>本地工作区账号</div>
            </div>
          </div>

          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#6b7280', padding: '0 8px 4px' }}>设置</div>
          <button
            type="button"
            className={`hk-nav-item ${tab === 'general' ? 'active' : ''}`}
            onClick={() => setTab('general')}
          >
            <span>常规</span>
          </button>
          <button
            type="button"
            className={`hk-nav-item ${tab === 'memory' ? 'active' : ''}`}
            onClick={() => setTab('memory')}
          >
            <span>记忆</span>
          </button>
          <button
            type="button"
            className={`hk-nav-item ${tab === 'model' ? 'active' : ''}`}
            onClick={() => setTab('model')}
          >
            <span>服务连接</span>
          </button>
        </div>

        <div className="hk-settings-body">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #eef0f3', paddingBottom: 12, marginBottom: 18 }}>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>
              {tab === 'general' ? '常规' : tab === 'memory' ? '学习记忆' : '服务连接'}
            </h2>
            <button type="button" className="hk-collapse-btn" onClick={onClose} aria-label="关闭设置">
              ✕
            </button>
          </div>

          {notice && (
            <div className="callout-verified" style={{ marginBottom: 14, fontSize: 12.5 }}>
              {notice}
            </div>
          )}

          {tab === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14, borderBottom: '1px solid #eef0f3' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>对话与薄弱点记忆</div>
                  <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 2 }}>
                    {memoryEnabled ? '已开启：学习轨迹与错因记忆将自动贴合讲解难度' : '已关闭：问答与课程策划不再主动注入个人薄弱点记录'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const nextVal = !memoryEnabled;
                    setMemoryEnabled(nextVal);
                    const nextPrefs = { ...prefs, memory_enabled: nextVal ? 'true' : 'false' };
                    setPrefs(nextPrefs);
                    savePrefs(nextPrefs);
                  }}
                  aria-label="切换学习记忆"
                  style={{
                    width: 44,
                    height: 24,
                    borderRadius: 999,
                    border: 'none',
                    background: memoryEnabled ? '#3b4f7d' : '#d1d5db',
                    position: 'relative',
                    cursor: 'pointer',
                    transition: 'background 0.16s ease',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 3,
                      left: memoryEnabled ? 23 : 3,
                      width: 18,
                      height: 18,
                      borderRadius: '999px',
                      background: '#ffffff',
                      transition: 'left 0.16s ease',
                    }}
                  />
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="field-label">默认学科</label>
                  <input
                    className="input"
                    value={prefs.preferred_subject}
                    onChange={(e) => setPrefs({ ...prefs, preferred_subject: e.target.value })}
                  />
                </div>
                <div>
                  <label className="field-label">默认学段</label>
                  <input
                    className="input"
                    value={prefs.preferred_grade}
                    onChange={(e) => setPrefs({ ...prefs, preferred_grade: e.target.value })}
                  />
                </div>
                <div>
                  <label className="field-label">备课常用课型</label>
                  <input
                    className="input"
                    value={prefs.preferred_lesson_type}
                    onChange={(e) => setPrefs({ ...prefs, preferred_lesson_type: e.target.value })}
                  />
                </div>
                <div>
                  <label className="field-label">习题难度梯度</label>
                  <input
                    className="input"
                    value={prefs.preferred_difficulty}
                    onChange={(e) => setPrefs({ ...prefs, preferred_difficulty: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving}
                  onClick={() => savePrefs({ ...prefs, memory_enabled: memoryEnabled ? 'true' : 'false' })}
                >
                  保存常规偏好
                </button>
              </div>
            </div>
          )}

          {tab === 'memory' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ fontSize: 13, color: '#6b7280' }}>
                  系统自动记录练习错因与掌握度，随时可组卷强化。
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={makingQuiz}
                  onClick={handleRemediationQuiz}
                >
                  {makingQuiz ? '正在组卷…' : '生成靶向巩固卷'}
                </button>
              </div>

              {weakTopics.length === 0 ? (
                <div className="card-compact" style={{ color: '#6b7280', fontSize: 13 }}>
                  暂无薄弱知识点记录，在课程随堂小测或题库练习提交后会自动收录。
                </div>
              ) : (
                weakTopics.map((w) => (
                  <div key={w.id} className="card-compact">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <strong style={{ fontSize: 13.5 }}>{w.topic_tag}</strong>
                      <span className="badge badge-info">掌握度 {Math.round(w.mastery_score)}%</span>
                    </div>
                    <div style={{ height: 6, background: '#f1f3f6', borderRadius: 999, overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{ width: `${Math.min(100, Math.max(8, w.mastery_score))}%`, height: '100%', background: '#3b4f7d' }} />
                    </div>
                    {w.mistake_patterns.length > 0 && (
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        高频易错点：{w.mistake_patterns.join('；')}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'model' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="field-label">接口协议</label>
                  <select className="select" value={protocol} onChange={(e) => setProtocol(e.target.value)}>
                    <option value="anthropic">Anthropic 兼容格式</option>
                    <option value="openai">OpenAI 兼容格式</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">模型名称</label>
                  <input className="input" value={model} onChange={(e) => setModel(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="field-label">服务地址</label>
                <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              </div>
              <div>
                <label className="field-label">访问密钥（留空保留当前配置）</label>
                <input
                  className="input"
                  type="password"
                  placeholder={llmStatus?.has_api_key ? '当前已配置密钥' : '填写密钥'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
              <div style={{ paddingTop: 6 }}>
                <button type="button" className="btn btn-primary" disabled={saving} onClick={saveModelConfig}>
                  更新连接配置
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
