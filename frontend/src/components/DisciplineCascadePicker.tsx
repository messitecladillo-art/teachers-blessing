import React from 'react';
import { DISCIPLINE_TAXONOMY } from '../data/disciplineTaxonomy';
import { DisciplineDomain } from '../types';

interface DisciplineCascadePickerProps {
  domainId: string;
  branch: string;
  subject: string;
  gradeLevel: string;
  domains?: DisciplineDomain[];
  onChange: (next: {
    domainId: string;
    domainName: string;
    branch: string;
    subject: string;
    gradeLevel: string;
  }) => void;
}

export const DisciplineCascadePicker: React.FC<DisciplineCascadePickerProps> = ({
  domainId,
  branch,
  subject,
  gradeLevel,
  domains = DISCIPLINE_TAXONOMY,
  onChange,
}) => {
  const activeDomain = domains.find((d) => d.id === domainId) || domains[0];
  const branches = activeDomain?.branches || [];
  const activeBranchObj = branches.find((b) => b.name === branch) || branches[0];

  const handleDomainChange = (nextDomainId: string) => {
    const dom = domains.find((d) => d.id === nextDomainId) || domains[0];
    const firstBranch = dom.branches[0];
    const nextSubject =
      dom.id === 'interdisciplinary'
        ? '跨学科主题学习 (PBL)'
        : `${dom.short_name} · ${firstBranch?.name || dom.name}`;
    onChange({
      domainId: dom.id,
      domainName: dom.name,
      branch: firstBranch?.name || '',
      subject: nextSubject,
      gradeLevel: firstBranch?.default_grade || dom.default_grades[0] || gradeLevel,
    });
  };

  const handleBranchChange = (nextBranchName: string) => {
    const brObj = branches.find((b) => b.name === nextBranchName);
    const nextSubject =
      activeDomain.id === 'interdisciplinary'
        ? `跨学科 · ${nextBranchName}`
        : `${activeDomain.short_name} · ${nextBranchName}`;
    onChange({
      domainId: activeDomain.id,
      domainName: activeDomain.name,
      branch: nextBranchName,
      subject: nextSubject,
      gradeLevel: brObj?.default_grade || gradeLevel,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <label className="field-label">一级学科门类（全科覆盖）</label>
        <select
          className="select"
          value={activeDomain?.id || ''}
          onChange={(e) => handleDomainChange(e.target.value)}
          data-testid="cascade-domain-select"
        >
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {typeof d.topic_count === 'number' ? ` (${d.topic_count})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 8 }}>
        <div>
          <label className="field-label">二级细分分支</label>
          <select
            className="select"
            value={activeBranchObj?.name || branch}
            onChange={(e) => handleBranchChange(e.target.value)}
            data-testid="cascade-branch-select"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label">适用学段</label>
          <input
            className="input"
            value={gradeLevel}
            onChange={(e) =>
              onChange({
                domainId: activeDomain.id,
                domainName: activeDomain.name,
                branch: activeBranchObj?.name || branch,
                subject,
                gradeLevel: e.target.value,
              })
            }
            data-testid="cascade-grade-input"
          />
        </div>
      </div>
    </div>
  );
};
