import React from 'react';
import { AnalysisOptions, AnalysisResult } from '../analysis/analyze';

export interface OptionsPanelProps {
  options: AnalysisOptions;
  onChange: (options: AnalysisOptions) => void;
  result: AnalysisResult | null;
}

export const OptionsPanel: React.FC<OptionsPanelProps> = ({
  options,
  onChange,
  result,
}) => {
  const updateOption = <K extends keyof AnalysisOptions>(
    key: K,
    value: AnalysisOptions[K]
  ) => {
    const next = { ...options, [key]: value };
    // If widening turned off, disable narrowing as well
    if (key === 'widening' && !value) {
      next.narrowing = false;
    }
    onChange(next);
  };

  const solve = result?.solve;
  const check = result?.check;

  const isUnterminated = options.widening === false && solve && solve.terminated === false;
  const iterationCap = solve?.iterations ?? options.maxIterations ?? 10000;

  return (
    <div className="options-panel">
      <h3 className="panel-title">Analysis Options & Statistics</h3>

      {/* Non-termination Red Banner */}
      {isUnterminated && (
        <div className="banner banner-danger" role="alert">
          <strong>⚠️ Did not terminate:</strong> hit the iteration cap ({iterationCap}). Turn widening on to compute fixpoint.
          <div className="banner-note">
            Annotations shown below represent partial states (not a fixpoint). Checker safety status is hidden.
          </div>
        </div>
      )}

      {/* Toggles Grid */}
      <div className="options-grid">
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={options.widening ?? true}
            onChange={(e) => updateOption('widening', e.target.checked)}
          />
          <span>Widening (∇)</span>
        </label>

        <label className={`toggle-label ${!options.widening ? 'disabled' : ''}`}>
          <input
            type="checkbox"
            checked={options.narrowing ?? true}
            disabled={!options.widening}
            onChange={(e) => updateOption('narrowing', e.target.checked)}
          />
          <span>Narrowing (Δ)</span>
        </label>

        <label className="toggle-label">
          <input
            type="checkbox"
            checked={options.thresholds ?? false}
            onChange={(e) => updateOption('thresholds', e.target.checked)}
          />
          <span>Threshold Widening</span>
        </label>

        <label className="toggle-label">
          <input
            type="checkbox"
            checked={options.reportSafe ?? true}
            onChange={(e) => updateOption('reportSafe', e.target.checked)}
          />
          <span>Report Safe Findings</span>
        </label>

        <div className="input-group">
          <label htmlFor="widening-delay">Widening Delay:</label>
          <input
            id="widening-delay"
            type="number"
            min={0}
            max={5}
            value={options.wideningDelay ?? 2}
            disabled={!options.widening}
            onChange={(e) => updateOption('wideningDelay', parseInt(e.target.value, 10) || 0)}
          />
        </div>

        <div className="input-group">
          <label htmlFor="narrowing-rounds">Narrowing Rounds:</label>
          <input
            id="narrowing-rounds"
            type="number"
            min={0}
            max={5}
            value={options.narrowingRounds ?? 3}
            disabled={!options.widening || !options.narrowing}
            onChange={(e) => updateOption('narrowingRounds', parseInt(e.target.value, 10) || 0)}
          />
        </div>

        <div className="input-group">
          <label htmlFor="unroll-loops">Loop Unrolling:</label>
          <input
            id="unroll-loops"
            type="number"
            min={0}
            max={3}
            value={options.unrollLoops ?? 0}
            onChange={(e) => updateOption('unrollLoops', parseInt(e.target.value, 10) || 0)}
          />
        </div>
      </div>

      {/* Summary Statistics Strip */}
      {solve && (
        <div className="summary-strip">
          <div className="stat-item">
            <span className="stat-label">Terminated:</span>
            <span className={`stat-value ${solve.terminated ? 'text-success' : 'text-danger'}`}>
              {solve.terminated ? 'Yes' : 'No (Cap Reached)'}
            </span>
          </div>

          <div className="stat-item">
            <span className="stat-label">Iterations:</span>
            <span className="stat-value">
              {solve.iterations} {solve.narrowingIterations > 0 ? `(+${solve.narrowingIterations} Δ)` : ''}
            </span>
          </div>

          <div className="stat-item">
            <span className="stat-label">Widening Points:</span>
            <span className="stat-value">{solve.wideningPoints ? solve.wideningPoints.size : 0}</span>
          </div>

          {check && (
            <div className="stat-item counts-item">
              <span className="count-badge count-safe" title="Safe findings">
                ✓ {check.summary.safe}
              </span>
              <span className="count-badge count-possible" title="Possible findings">
                ⚠️ {check.summary.possible}
              </span>
              <span className="count-badge count-definite" title="Definite findings">
                ❌ {check.summary.definite}
              </span>
              <span className="count-badge count-unreachable" title="Unreachable lines">
                🚫 {check.summary.unreachable}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
