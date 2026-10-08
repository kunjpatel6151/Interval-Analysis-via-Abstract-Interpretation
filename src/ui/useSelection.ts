import { useState, useEffect, useRef, useCallback } from 'react';
import { AnalysisResult } from '../analysis/analyze';
import { NodeId } from '../cfg/types';

export interface SelectionState {
  step: number;
  selectedNode: NodeId | null;
  selectedVar: string | null;
  playing: boolean;
  speedMs: number;
  dashboardMode: boolean;
}

export function useSelection(result: AnalysisResult | null) {
  const [step, setStepState] = useState<number>(-1);
  const [selectedNode, setSelectedNode] = useState<NodeId | null>(null);
  const [selectedVar, setSelectedVar] = useState<string | null>(null);
  const [playing, setPlaying] = useState<boolean>(false);
  const [speedMs, setSpeedMs] = useState<number>(400);
  const [dashboardMode, setDashboardMode] = useState<boolean>(false);

  const totalSteps = result?.solve?.trace ? result.solve.trace.length : 0;

  // When analysis result changes, default step to the final step
  useEffect(() => {
    if (result?.solve?.trace) {
      const lastStep = Math.max(-1, result.solve.trace.length - 1);
      setStepState(lastStep);

      // Clear selectedNode if node no longer exists in CFG
      if (selectedNode !== null && result.cfg) {
        const exists = result.cfg.nodes.some((n) => n.id === selectedNode);
        if (!exists) {
          setSelectedNode(null);
        }
      }
    }
  }, [result]);

  const setStep = useCallback(
    (n: number) => {
      const maxIndex = Math.max(-1, totalSteps - 1);
      const clamped = Math.max(-1, Math.min(n, maxIndex));
      setStepState(clamped);
      if (clamped >= maxIndex) {
        setPlaying(false);
      }
    },
    [totalSteps]
  );

  // Playback timer
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (playing) {
      timerRef.current = window.setInterval(() => {
        setStepState((prev) => {
          const maxIndex = totalSteps - 1;
          if (prev >= maxIndex) {
            setPlaying(false);
            return maxIndex;
          }
          return prev + 1;
        });
      }, speedMs);
    } else {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [playing, speedMs, totalSteps]);

  const togglePlay = useCallback(() => {
    if (totalSteps === 0) return;
    setPlaying((prev) => {
      if (!prev && step >= totalSteps - 1) {
        setStepState(-1); // Restart from beginning if at end
      }
      return !prev;
    });
  }, [step, totalSteps]);

  return {
    step,
    setStep,
    selectedNode,
    setSelectedNode,
    selectedVar,
    setSelectedVar,
    playing,
    setPlaying,
    togglePlay,
    speedMs,
    setSpeedMs,
    dashboardMode,
    setDashboardMode,
    totalSteps,
  };
}
