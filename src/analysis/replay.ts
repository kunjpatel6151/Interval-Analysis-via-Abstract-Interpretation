import { SolveResult } from './fixpoint';
import { NodeId } from '../cfg/types';
import { AbstractState } from '../domain/state';
import { Interval, intervalToString, equals } from '../domain/interval';

export interface IntervalHistoryEntry {
  step: number; // -1 for initial state
  interval: Interval;
  widened: boolean;
  phase: 'ascending' | 'narrowing' | 'initial';
}

export interface PhaseBoundaries {
  ascendingEnd: number; // index of last ascending step (-1 if none)
  narrowingStart: number; // index of first narrowing step (-1 if none)
  narrowingEnd: number; // index of last narrowing step (-1 if none)
  totalSteps: number;
}

export interface StepDiff {
  node: NodeId;
  edgeId: number;
  changedVars: string[];
  widened: boolean;
  phase: 'ascending' | 'narrowing';
  oldState: AbstractState;
  newState: AbstractState;
}

const CHECKPOINT_INTERVAL = 50;

/**
 * WeakMap cache for trace step state checkpoints to allow fast O(1) scrubbing
 * without re-running trace step replays from step 0.
 */
const stateCheckpointCache = new WeakMap<
  SolveResult,
  Map<number, Map<NodeId, AbstractState>>
>();

/**
 * Builds or retrieves cached state checkpoints every 50 steps for a SolveResult.
 */
function getCheckpoints(
  result: SolveResult
): Map<number, Map<NodeId, AbstractState>> {
  let cached = stateCheckpointCache.get(result);
  if (cached) {
    return cached;
  }

  cached = new Map<number, Map<NodeId, AbstractState>>();
  stateCheckpointCache.set(result, cached);

  if (!result.trace || result.trace.length === 0) {
    return cached;
  }

  // Initial state at step -1
  const initialMap = new Map<NodeId, AbstractState>();
  // Find all node IDs from trace or result.states
  const allNodes = Array.from(result.states.keys());
  for (const node of allNodes) {
    initialMap.set(node, AbstractState.UNREACHABLE);
  }
  // Entry node (typically node 0) starts as empty reachable state
  if (allNodes.length > 0) {
    initialMap.set(allNodes[0], AbstractState.empty());
  }

  cached.set(-1, initialMap);

  let currentMap = new Map(initialMap);

  for (let i = 0; i < result.trace.length; i++) {
    const step = result.trace[i];
    currentMap.set(step.node, step.newState);

    if ((i + 1) % CHECKPOINT_INTERVAL === 0) {
      cached.set(i, new Map(currentMap));
    }
  }

  return cached;
}

/**
 * Reconstructs all node abstract states after applying trace steps 0..step.
 * step = -1 returns the initial states before trace execution.
 * Fast O(step mod 50) using 50-step checkpoints.
 */
export function statesAtStep(
  result: SolveResult,
  step: number
): Map<NodeId, AbstractState> {
  const emptyMap = new Map<NodeId, AbstractState>();
  if (!result || !result.states) {
    return emptyMap;
  }

  const traceLen = result.trace ? result.trace.length : 0;
  if (traceLen === 0) {
    return result.states;
  }

  // Clamp step
  const clampedStep = Math.max(-1, Math.min(step, traceLen - 1));

  if (clampedStep === traceLen - 1) {
    return result.states;
  }

  const checkpoints = getCheckpoints(result);

  // Find highest checkpoint <= clampedStep
  let checkpointStep = -1;
  for (const cpStep of checkpoints.keys()) {
    if (cpStep <= clampedStep && cpStep > checkpointStep) {
      checkpointStep = cpStep;
    }
  }

  const baseMap = checkpoints.get(checkpointStep) || checkpoints.get(-1)!;
  const resultMap = new Map(baseMap);

  // Replay steps from checkpointStep + 1 up to clampedStep
  for (let i = checkpointStep + 1; i <= clampedStep; i++) {
    const stepObj = result.trace[i];
    resultMap.set(stepObj.node, stepObj.newState);
  }

  return resultMap;
}

/**
 * Returns summary diff information for a single trace step.
 */
export function stepDiff(result: SolveResult, step: number): StepDiff | null {
  if (!result || !result.trace || step < 0 || step >= result.trace.length) {
    return null;
  }

  const st = result.trace[step];
  const changedVars: string[] = [];

  const allVars = new Set([
    ...st.oldState.getVars().keys(),
    ...st.newState.getVars().keys(),
  ]);

  for (const v of allVars) {
    if (!equals(st.oldState.get(v), st.newState.get(v))) {
      changedVars.push(v);
    }
  }

  return {
    node: st.node,
    edgeId: st.edgeId,
    changedVars,
    widened: st.widened,
    phase: st.phase,
    oldState: st.oldState,
    newState: st.newState,
  };
}

/**
 * Returns the sequence of interval values a variable took at a specific node,
 * one entry per trace step that updated that node (plus initial state at step -1).
 */
export function intervalHistory(
  result: SolveResult,
  node: NodeId,
  variable: string
): IntervalHistoryEntry[] {
  const history: IntervalHistoryEntry[] = [];
  if (!result || !result.trace) {
    return history;
  }

  const initStates = statesAtStep(result, -1);
  const initNodeState = initStates.get(node);
  if (initNodeState && !initNodeState.isUnreachable()) {
    const val = initNodeState.get(variable);
    history.push({
      step: -1,
      interval: val,
      widened: false,
      phase: 'initial',
    });
  }

  for (let i = 0; i < result.trace.length; i++) {
    const st = result.trace[i];
    if (st.node === node) {
      const oldVal = st.oldState.get(variable);
      const newVal = st.newState.get(variable);
      if (!equals(oldVal, newVal)) {
        history.push({
          step: i,
          interval: newVal,
          widened: st.widened,
          phase: st.phase,
        });
      }
    }
  }

  return history;
}

/**
 * Formats a human-readable text label for a trace step.
 * e.g. "#7 ascending, node 3, i: [0,1] -> [0,+∞] (∇)"
 */
export function stepLabel(result: SolveResult, step: number): string {
  if (!result || !result.trace || step < 0 || step >= result.trace.length) {
    return 'Initial State';
  }

  const diff = stepDiff(result, step);
  if (!diff) {
    return `Step #${step + 1}`;
  }

  const mark = diff.widened
    ? ' (∇)'
    : diff.phase === 'narrowing'
    ? ' (Δ)'
    : '';

  const varChanges = diff.changedVars.map((v) => {
    const oldStr = intervalToString(diff.oldState.get(v));
    const newStr = intervalToString(diff.newState.get(v));
    return `${v}: ${oldStr} -> ${newStr}`;
  });

  const varText = varChanges.length > 0 ? `, ${varChanges.join(', ')}` : '';
  return `#${step + 1} ${diff.phase}, node ${diff.node}${varText}${mark}`;
}

/**
 * Finds index boundaries for ascending and narrowing phases in trace.
 */
export function phaseBoundaries(result: SolveResult): PhaseBoundaries {
  if (!result || !result.trace || result.trace.length === 0) {
    return { ascendingEnd: -1, narrowingStart: -1, narrowingEnd: -1, totalSteps: 0 };
  }

  let ascendingEnd = -1;
  let narrowingStart = -1;
  let narrowingEnd = -1;

  for (let i = 0; i < result.trace.length; i++) {
    if (result.trace[i].phase === 'ascending') {
      ascendingEnd = i;
    } else if (result.trace[i].phase === 'narrowing') {
      if (narrowingStart === -1) {
        narrowingStart = i;
      }
      narrowingEnd = i;
    }
  }

  return {
    ascendingEnd,
    narrowingStart,
    narrowingEnd,
    totalSteps: result.trace.length,
  };
}
