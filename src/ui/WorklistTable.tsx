import React, { useRef, useEffect } from 'react';
import { SolveResult, TraceStep } from '../analysis/fixpoint';
import { CFG } from '../cfg/types';
import { prettyPrintAction } from '../cfg/printer';
import { intervalToString, equals } from '../domain/interval';
import { PlayControls } from './PlayControls';

export interface WorklistTableProps {
  solveResult: SolveResult | null;
  cfg: CFG | null;
  step: number;
  onSetStep: (step: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  speedMs: number;
  onSetSpeed: (speed: number) => void;
  onSelectNode: (nodeId: number) => void;
  isWideningOffAndUnterminated?: boolean;
}

const MAX_DISPLAY_STEPS = 2000;
const WINDOW_PADDING = 25; // Render 25 rows before and 25 rows after current step

export const WorklistTable: React.FC<WorklistTableProps> = ({
  solveResult,
  cfg,
  step,
  onSetStep,
  playing,
  onTogglePlay,
  speedMs,
  onSetSpeed,
  onSelectNode,
  isWideningOffAndUnterminated = false,
}) => {
  const currentRowRef = useRef<HTMLTableRowElement | null>(null);

  // Auto-scroll current step row into view
  useEffect(() => {
    if (currentRowRef.current && typeof currentRowRef.current.scrollIntoView === 'function') {
      currentRowRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [step]);

  if (!solveResult || !solveResult.trace || solveResult.trace.length === 0) {
    return (
      <div className="worklist-table-panel">
        <h3 className="panel-title">Worklist Iteration Table</h3>
        <div className="empty-state">
          <p>No trace steps recorded.</p>
        </div>
      </div>
    );
  }

  const fullTrace = solveResult.trace;
  const isTruncated = fullTrace.length > MAX_DISPLAY_STEPS;
  const displayedTrace = isTruncated
    ? fullTrace.slice(0, MAX_DISPLAY_STEPS)
    : fullTrace;

  // Windowing: calculate start and end indices around current step
  const currentIdx = Math.max(0, step);
  const windowStart = Math.max(0, currentIdx - WINDOW_PADDING);
  const windowEnd = Math.min(displayedTrace.length, currentIdx + WINDOW_PADDING + 1);

  // Map edgeId to action pretty print string
  const edgeMap = new Map<number, string>();
  if (cfg) {
    for (const e of cfg.edges) {
      edgeMap.set(e.id, prettyPrintAction(e.action));
    }
  }

  function formatStepVars(st: TraceStep): string {
    const allVars = new Set([
      ...st.oldState.getVars().keys(),
      ...st.newState.getVars().keys(),
    ]);
    const changes: string[] = [];
    for (const v of allVars) {
      const oldInv = st.oldState.get(v);
      const newInv = st.newState.get(v);
      if (!equals(oldInv, newInv)) {
        changes.push(
          `${v}: ${intervalToString(oldInv)} -> ${intervalToString(newInv)}`
        );
      }
    }
    return changes.join(', ');
  }

  return (
    <div className="worklist-table-panel">
      <h3 className="panel-title">Worklist Fixpoint Iterations</h3>

      {isWideningOffAndUnterminated && (
        <div className="banner banner-danger">
          ⚠️ <strong>Iteration Cap Reached:</strong> Trace cut off at iteration limit because widening was disabled.
        </div>
      )}

      {isTruncated && (
        <div className="banner banner-warning">
          ℹ️ Showing first {MAX_DISPLAY_STEPS.toLocaleString()} of {fullTrace.length.toLocaleString()} trace steps.
        </div>
      )}

      {/* Shared Playback Controls */}
      <PlayControls
        solveResult={solveResult}
        step={step}
        onSetStep={onSetStep}
        playing={playing}
        onTogglePlay={onTogglePlay}
        speedMs={speedMs}
        onSetSpeed={onSetSpeed}
      />

      {/* Windowed Table */}
      <div className="table-container">
        <table className="worklist-table">
          <thead>
            <tr>
              <th>Step #</th>
              <th>Phase</th>
              <th>Node</th>
              <th>Edge Action</th>
              <th>State Transition (Old -&gt; New)</th>
              <th>Operator</th>
            </tr>
          </thead>
          <tbody>
            {windowStart > 0 && (
              <tr className="window-placeholder-row">
                <td colSpan={6}>
                  ... {windowStart} preceding steps hidden ...
                </td>
              </tr>
            )}

            {displayedTrace.slice(windowStart, windowEnd).map((st, offset) => {
              const actualIndex = windowStart + offset;
              const isCurrent = actualIndex === step;
              const isFuture = actualIndex > step;
              const edgeLabel = edgeMap.get(st.edgeId) || (st.phase === 'narrowing' ? 'narrowing pass' : 'edge');

              let operatorMark = '';
              if (st.widened) operatorMark = '∇ Widening';
              else if (st.phase === 'narrowing') operatorMark = 'Δ Narrowing';

              return (
                <tr
                  key={actualIndex}
                  ref={isCurrent ? currentRowRef : null}
                  className={`trace-row ${isCurrent ? 'row-current' : ''} ${
                    isFuture ? 'row-future' : ''
                  }`}
                  onClick={() => {
                    onSetStep(actualIndex);
                    onSelectNode(st.node);
                  }}
                >
                  <td className="col-step">#{actualIndex + 1}</td>
                  <td className="col-phase">
                    <span className={`phase-chip phase-${st.phase}`}>
                      {st.phase}
                    </span>
                  </td>
                  <td className="col-node">Node {st.node}</td>
                  <td className="col-edge">{edgeLabel}</td>
                  <td className="col-transition">{formatStepVars(st)}</td>
                  <td className="col-op">
                    {operatorMark && (
                      <span className={`op-chip ${st.widened ? 'op-widen' : 'op-narrow'}`}>
                        {operatorMark}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}

            {windowEnd < displayedTrace.length && (
              <tr className="window-placeholder-row">
                <td colSpan={6}>
                  ... {displayedTrace.length - windowEnd} remaining steps hidden ...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
