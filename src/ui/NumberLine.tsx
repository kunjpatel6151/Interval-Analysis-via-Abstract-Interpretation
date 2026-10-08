import React, { useMemo } from 'react';
import * as d3 from 'd3';
import { SolveResult } from '../analysis/fixpoint';
import { CFG, NodeId } from '../cfg/types';
import { intervalHistory } from '../analysis/replay';
import { intervalToString, INT32_MIN, INT32_MAX } from '../domain/interval';

export interface NumberLineProps {
  solveResult: SolveResult | null;
  cfg: CFG | null;
  step: number;
  selectedNode: NodeId | null;
  selectedVar: string | null;
  onSelectNode: (nodeId: NodeId) => void;
  onSelectVar: (varName: string) => void;
  onSetStep: (step: number) => void;
}

export const NumberLine: React.FC<NumberLineProps> = ({
  solveResult,
  cfg,
  step,
  selectedNode,
  selectedVar,
  onSelectNode,
  onSelectVar,
  onSetStep,
}) => {
  // Determine default node (first loop head, or exit node, or 0)
  const defaultNode = useMemo(() => {
    if (cfg && cfg.loopHeads.length > 0) {
      return cfg.loopHeads[0];
    }
    return cfg ? cfg.exit : 0;
  }, [cfg]);

  const activeNode = selectedNode ?? defaultNode;

  // Available variables at activeNode
  const availableVars = useMemo(() => {
    if (!solveResult || !solveResult.states) return [];
    const state = solveResult.states.get(activeNode);
    if (!state || state.isUnreachable()) return [];
    return Array.from(state.getVars().keys()).sort();
  }, [solveResult, activeNode]);

  const activeVar = selectedVar && availableVars.includes(selectedVar)
    ? selectedVar
    : availableVars[0] ?? 'i';

  // Compute interval history for (activeNode, activeVar)
  const history = useMemo(() => {
    if (!solveResult) return [];
    return intervalHistory(solveResult, activeNode, activeVar);
  }, [solveResult, activeNode, activeVar]);

  // Compute numeric domain range for finite bounds
  const domainRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;

    for (const entry of history) {
      if (!entry.interval.bottom) {
        if (Number.isFinite(entry.interval.lo)) {
          min = Math.min(min, entry.interval.lo);
        }
        if (Number.isFinite(entry.interval.hi)) {
          max = Math.max(max, entry.interval.hi);
        }
      }
    }

    if (min === Infinity) min = -10;
    if (max === -Infinity) max = 100;
    if (min === max) {
      min = min - 5;
      max = max + 5;
    }

    // Add padding
    const span = max - min;
    const padding = Math.max(2, span * 0.15);
    return {
      domainMin: Math.floor(min - padding),
      domainMax: Math.ceil(max + padding),
    };
  }, [history]);

  if (!solveResult || !cfg) {
    return (
      <div className="number-line-panel">
        <h3 className="panel-title">Number Line Interval Visualizer</h3>
        <div className="empty-state">
          <p>No static analysis data available.</p>
        </div>
      </div>
    );
  }

  const { domainMin, domainMax } = domainRange;

  // D3 linear scale
  const svgWidth = 650;
  const margin = { top: 20, right: 40, bottom: 30, left: 100 };
  const chartWidth = svgWidth - margin.left - margin.right;
  const barHeight = 24;
  const barGap = 8;

  const svgHeight = margin.top + margin.bottom + Math.max(1, history.length) * (barHeight + barGap) + 40;

  const xScale = d3.scaleLinear().domain([domainMin, domainMax]).range([0, chartWidth]);

  return (
    <div className="number-line-panel">
      <div className="panel-header">
        <h3 className="panel-title">Interval Number Line History</h3>

        {/* Selectors */}
        <div className="nl-selectors">
          <div className="input-group-inline">
            <label htmlFor="nl-node-select">Node:</label>
            <select
              id="nl-node-select"
              value={activeNode}
              onChange={(e) => onSelectNode(parseInt(e.target.value, 10))}
            >
              {cfg.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  Node {n.id} {cfg.loopHeads.includes(n.id) ? ' (Loop Head)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="input-group-inline">
            <label htmlFor="nl-var-select">Variable:</label>
            <select
              id="nl-var-select"
              value={activeVar}
              onChange={(e) => onSelectVar(e.target.value)}
              disabled={availableVars.length === 0}
            >
              {availableVars.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {history.length === 0 ? (
        <div className="empty-state">
          <p>No history available for variable '{activeVar}' at Node {activeNode}.</p>
        </div>
      ) : (
        <div className="nl-chart-container">
          <svg
            className="nl-svg"
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            width="100%"
            height="100%"
            aria-label={`Number line interval evolution chart for ${activeVar}`}
          >
            <defs>
              {/* Infinite Right Arrow */}
              <marker
                id="arrow-inf-right"
                viewBox="0 0 10 10"
                refX="5"
                refY="5"
                markerWidth="8"
                markerHeight="8"
                orient="auto"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--primary-color)" />
              </marker>

              {/* Infinite Left Arrow */}
              <marker
                id="arrow-inf-left"
                viewBox="0 0 10 10"
                refX="5"
                refY="5"
                markerWidth="8"
                markerHeight="8"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--primary-color)" />
              </marker>
            </defs>

            <g transform={`translate(${margin.left}, ${margin.top})`}>
              {/* X Axis Reference Ticks */}
              {xScale.ticks(6).map((tickVal) => (
                <g key={tickVal} transform={`translate(${xScale(tickVal)}, 0)`}>
                  <line y1="0" y2={svgHeight - margin.top - margin.bottom} stroke="var(--border-color)" strokeDasharray="3,3" />
                  <text y={svgHeight - margin.top - margin.bottom + 16} textAnchor="middle" className="nl-axis-text">
                    {tickVal}
                  </text>
                </g>
              ))}

              {/* Int32 Reference Lines if within domain */}
              {domainMin <= INT32_MIN && INT32_MIN <= domainMax && (
                <g transform={`translate(${xScale(INT32_MIN)}, 0)`}>
                  <line y1="0" y2={svgHeight - margin.top - margin.bottom} stroke="#ef4444" strokeWidth="2" strokeDasharray="4,2" />
                  <text y="-5" textAnchor="middle" className="ref-line-text">
                    Int32 Min
                  </text>
                </g>
              )}

              {domainMin <= INT32_MAX && INT32_MAX <= domainMax && (
                <g transform={`translate(${xScale(INT32_MAX)}, 0)`}>
                  <line y1="0" y2={svgHeight - margin.top - margin.bottom} stroke="#ef4444" strokeWidth="2" strokeDasharray="4,2" />
                  <text y="-5" textAnchor="middle" className="ref-line-text">
                    Int32 Max
                  </text>
                </g>
              )}

              {/* Stacked History Bars */}
              {history.map((entry, idx) => {
                const y = idx * (barHeight + barGap);
                const isCurrent = entry.step === step || (step === -1 && entry.step === -1);
                const isFuture = entry.step > step;

                if (entry.interval.bottom) return null;

                const isNegInf = entry.interval.lo === -Infinity;
                const isPosInf = entry.interval.hi === Infinity;

                const x1 = isNegInf ? 0 : xScale(Math.max(domainMin, entry.interval.lo));
                const x2 = isPosInf ? chartWidth : xScale(Math.min(domainMax, entry.interval.hi));
                const width = Math.max(6, x2 - x1);

                let barPhaseClass = `phase-${entry.phase}`;
                if (entry.widened) barPhaseClass = 'phase-widened';

                let badgeText = '';
                if (entry.widened) badgeText = '∇ WIDENED';
                else if (entry.phase === 'narrowing') badgeText = 'Δ NARROWED';
                else if (entry.phase === 'initial') badgeText = 'INIT';

                return (
                  <g
                    key={idx}
                    transform={`translate(0, ${y})`}
                    className={`nl-bar-group ${isCurrent ? 'bar-current' : ''} ${isFuture ? 'bar-future' : ''}`}
                    onClick={() => entry.step !== -1 && onSetStep(entry.step)}
                    style={{ cursor: entry.step !== -1 ? 'pointer' : 'default' }}
                  >
                    {/* Y Axis Step Label */}
                    <text x="-10" y={barHeight / 2 + 4} textAnchor="end" className="nl-step-text">
                      {entry.step === -1 ? 'Init' : `Step #${entry.step + 1}`}
                    </text>

                    {/* Interval Bar */}
                    <rect
                      x={x1}
                      y="0"
                      width={width}
                      height={barHeight}
                      rx="4"
                      className={`nl-bar ${barPhaseClass}`}
                    />

                    {/* Left Infinite Arrow */}
                    {isNegInf && (
                      <line
                        x1={x1 + 10}
                        y1={barHeight / 2}
                        x2={0}
                        y2={barHeight / 2}
                        stroke="var(--primary-color)"
                        strokeWidth="3"
                        markerEnd="url(#arrow-inf-left)"
                      />
                    )}

                    {/* Right Infinite Arrow */}
                    {isPosInf && (
                      <line
                        x1={x2 - 10}
                        y1={barHeight / 2}
                        x2={chartWidth}
                        y2={barHeight / 2}
                        stroke="var(--primary-color)"
                        strokeWidth="3"
                        markerEnd="url(#arrow-inf-right)"
                      />
                    )}

                    {/* Text Label on Bar */}
                    <text x={x1 + width / 2} y={barHeight / 2 + 4} textAnchor="middle" className="nl-bar-text">
                      {intervalToString(entry.interval)} {badgeText ? ` (${badgeText})` : ''}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      )}

      {/* Accessible HTML Table for Screen Readers */}
      <div className="sr-only">
        <h4>Accessible History Table for {activeVar} at Node {activeNode}</h4>
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>Phase</th>
              <th>Interval</th>
              <th>Widened</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i}>
                <td>{h.step === -1 ? 'Initial' : h.step + 1}</td>
                <td>{h.phase}</td>
                <td>{intervalToString(h.interval)}</td>
                <td>{h.widened ? 'Yes (∇)' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
