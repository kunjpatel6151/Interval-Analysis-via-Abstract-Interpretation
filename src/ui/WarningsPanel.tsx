import React, { useState } from 'react';
import { Finding, Severity, CheckResult } from '../analysis/checker';

export interface WarningsPanelProps {
  checkResult: CheckResult | null;
  isParseError?: boolean;
  onSelectLine: (line: number) => void;
}

const SEVERITY_ICONS: Record<Severity, string> = {
  safe: '✓',
  possible: '⚠️',
  definite: '❌',
  unreachable: '🚫',
};

export const WarningsPanel: React.FC<WarningsPanelProps> = ({
  checkResult,
  isParseError = false,
  onSelectLine,
}) => {
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [selectedKind, setSelectedKind] = useState<string>('all');

  if (isParseError) {
    return (
      <div className="warnings-panel">
        <h3 className="panel-title">Findings & Diagnostics</h3>
        <div className="empty-state empty-state-error">
          <span className="empty-icon">⚠️</span>
          <p>Parse Error: Fix syntax errors to view static analysis findings.</p>
        </div>
      </div>
    );
  }

  if (!checkResult || checkResult.findings.length === 0) {
    return (
      <div className="warnings-panel">
        <h3 className="panel-title">Findings & Diagnostics</h3>
        <div className="empty-state">
          <span className="empty-icon">🎉</span>
          <p>No findings to display.</p>
        </div>
      </div>
    );
  }

  // Filter findings
  const filtered = checkResult.findings.filter((f) => {
    if (selectedSeverity !== 'all' && f.severity !== selectedSeverity) return false;
    if (selectedKind !== 'all' && f.kind !== selectedKind) return false;
    return true;
  });

  // Sort findings by line number
  const sorted = [...filtered].sort((a, b) => a.line - b.line);

  function formatSeverityLabel(finding: Finding): string {
    if (finding.kind === 'assertion') {
      if (finding.severity === 'safe') return 'PROVEN';
      if (finding.severity === 'possible') return 'UNPROVEN';
      if (finding.severity === 'definite') return 'FAILS';
    }
    return finding.severity.toUpperCase();
  }

  return (
    <div className="warnings-panel">
      <div className="panel-header">
        <h3 className="panel-title">Findings ({sorted.length})</h3>
      </div>

      {/* Filter Chips */}
      <div className="filter-chips">
        <div className="chip-group">
          <span className="chip-label">Severity:</span>
          {['all', 'possible', 'definite', 'unreachable', 'safe'].map((sev) => (
            <button
              key={sev}
              type="button"
              className={`chip ${selectedSeverity === sev ? 'active' : ''}`}
              onClick={() => setSelectedSeverity(sev)}
            >
              {sev === 'all' ? 'All' : `${SEVERITY_ICONS[sev as Severity]} ${sev}`}
            </button>
          ))}
        </div>

        <div className="chip-group">
          <span className="chip-label">Kind:</span>
          {['all', 'div-by-zero', 'array-bounds', 'overflow', 'assertion', 'unreachable'].map(
            (kind) => (
              <button
                key={kind}
                type="button"
                className={`chip ${selectedKind === kind ? 'active' : ''}`}
                onClick={() => setSelectedKind(kind)}
              >
                {kind}
              </button>
            )
          )}
        </div>
      </div>

      {/* Findings List / Table */}
      {sorted.length === 0 ? (
        <div className="empty-state">
          <p>No findings match selected filters.</p>
        </div>
      ) : (
        <div className="findings-list">
          {sorted.map((finding) => (
            <div
              key={finding.id}
              className={`finding-row severity-${finding.severity}`}
              onClick={() => onSelectLine(finding.line)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelectLine(finding.line)}
            >
              <div className="finding-col-badge">
                <span className={`severity-chip chip-${finding.severity}`}>
                  <span className="chip-icon">{SEVERITY_ICONS[finding.severity]}</span>
                  <span className="chip-text">{formatSeverityLabel(finding)}</span>
                </span>
              </div>

              <div className="finding-col-line">Line {finding.line}</div>
              <div className="finding-col-kind">{finding.kind}</div>
              <div className="finding-col-msg">{finding.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
