import React from 'react';
import { SolveResult } from '../analysis/fixpoint';
import { stepLabel, phaseBoundaries } from '../analysis/replay';

export interface PlayControlsProps {
  solveResult: SolveResult | null;
  step: number;
  onSetStep: (step: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  speedMs: number;
  onSetSpeed: (speedMs: number) => void;
}

export const PlayControls: React.FC<PlayControlsProps> = ({
  solveResult,
  step,
  onSetStep,
  playing,
  onTogglePlay,
  speedMs,
  onSetSpeed,
}) => {
  const totalSteps = solveResult?.trace ? solveResult.trace.length : 0;
  const maxStep = Math.max(-1, totalSteps - 1);

  const boundaries = solveResult ? phaseBoundaries(solveResult) : null;
  const labelText = solveResult ? stepLabel(solveResult, step) : 'No trace';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onSetStep(Math.max(-1, step - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onSetStep(Math.min(maxStep, step + 1));
    } else if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      onTogglePlay();
    }
  };

  const handleJumpNarrowing = () => {
    if (boundaries && boundaries.narrowingStart !== -1) {
      onSetStep(boundaries.narrowingStart);
    }
  };

  return (
    <div
      className="play-controls-bar"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Fixpoint Trace Playback Controls (Use Left/Right arrows to step, Space to play/pause)"
    >
      <div className="play-controls-top">
        <div className="step-info-label" title={labelText}>
          <span className="step-count-badge">
            {step === -1 ? 'Initial State' : `Step ${step + 1} of ${totalSteps}`}
          </span>
          <span className="step-desc-text">{labelText}</span>
        </div>

        <div className="controls-right-group">
          {boundaries && boundaries.narrowingStart !== -1 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleJumpNarrowing}
              title="Jump to start of narrowing phase"
            >
              Go to Narrowing (Δ)
            </button>
          )}

          <div className="speed-select-group">
            <label htmlFor="speed-select" className="sr-only">
              Playback Speed
            </label>
            <select
              id="speed-select"
              className="speed-dropdown"
              value={speedMs}
              onChange={(e) => onSetSpeed(parseInt(e.target.value, 10))}
              aria-label="Playback Speed"
            >
              <option value={800}>0.5x (Slow)</option>
              <option value={400}>1x (Normal)</option>
              <option value={100}>4x (Fast)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Slider & Buttons */}
      <div className="play-controls-bottom">
        <div className="button-group">
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => onSetStep(-1)}
            disabled={step <= -1}
            title="First step (Initial state)"
            aria-label="First step"
          >
            ⏮
          </button>
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => onSetStep(Math.max(-1, step - 1))}
            disabled={step <= -1}
            title="Previous step (Left Arrow)"
            aria-label="Previous step"
          >
            ◀
          </button>
          <button
            type="button"
            className={`btn btn-icon btn-play ${playing ? 'active' : ''}`}
            onClick={onTogglePlay}
            disabled={totalSteps === 0}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => onSetStep(Math.min(maxStep, step + 1))}
            disabled={step >= maxStep}
            title="Next step (Right Arrow)"
            aria-label="Next step"
          >
            ▶
          </button>
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => onSetStep(maxStep)}
            disabled={step >= maxStep}
            title="Last step (Final fixpoint)"
            aria-label="Last step"
          >
            ⏭
          </button>
        </div>

        <input
          type="range"
          className="step-slider"
          min={-1}
          max={maxStep}
          value={step}
          onChange={(e) => onSetStep(parseInt(e.target.value, 10))}
          aria-label="Step slider"
        />
      </div>
    </div>
  );
};
