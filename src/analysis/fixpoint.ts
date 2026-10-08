import { CFG, NodeId } from '../cfg/types';
import { reversePostOrder } from '../cfg/traversal';
import { AbstractState } from '../domain/state';
import { transfer } from './transfer';
import { Observer } from './eval';
import { widenState, narrowState } from './widen';

export interface SolveOptions {
  widening?: boolean;          // default true
  narrowing?: boolean;         // default true
  thresholds?: boolean;        // default false
  thresholdsList?: number[];   // harvested program thresholds
  wideningDelay?: number;      // default 2 (visits before widening)
  narrowingRounds?: number;    // default 3
  unrollLoops?: number;        // default 0
  maxIterations?: number;      // default 10000
  recordTrace?: boolean;       // default true
}

export interface TraceStep {
  iteration: number;
  node: NodeId;
  edgeId: number;
  oldState: AbstractState;
  newState: AbstractState;
  widened: boolean;
  phase: 'ascending' | 'narrowing';
}

export interface SolveResult {
  states: Map<NodeId, AbstractState>;
  trace: TraceStep[];
  terminated: boolean;
  iterations: number;
  ascendingIterations: number;
  narrowingIterations: number;
  wideningPoints: Set<NodeId>;
}

/**
 * Identifies variables modified within the natural loop of each loop head.
 * In nested loops, restricting widening at loop head H to variables modified within
 * H's loop prevents widening pollution on loop-invariant outer variables.
 *
 * Uses RPO ranking to correctly identify back edges: an edge u→H is a back edge
 * if rpoRank[u] > rpoRank[H] (the source appears later in topological order).
 */
function getLoopModifiedVars(cfg: CFG, rpoRank: Map<NodeId, number>): Map<NodeId, Set<string>> {
  const result = new Map<NodeId, Set<string>>();

  for (const head of cfg.loopHeads) {
    const modVars = new Set<string>();

    const headRank = rpoRank.get(head) ?? 0;
    const inEdges = cfg.pred.get(head) || [];

    // Back-edge predecessors: nodes with higher RPO rank (later in topological order)
    const backPreds = inEdges
      .filter((e) => (rpoRank.get(e.from) ?? 0) > headRank)
      .map((e) => e.from);

    const loopNodes = new Set<NodeId>();
    loopNodes.add(head);

    // Flood-fill backward from back-edge predecessors to find loop body
    const queue: NodeId[] = [];
    for (const bp of backPreds) {
      if (bp !== head && !loopNodes.has(bp)) {
        loopNodes.add(bp);
        queue.push(bp);
      }
    }

    while (queue.length > 0) {
      const u = queue.shift()!;
      for (const predEdge of cfg.pred.get(u) || []) {
        const v = predEdge.from;
        if (v !== head && !loopNodes.has(v)) {
          loopNodes.add(v);
          queue.push(v);
        }
      }
    }

    for (const node of loopNodes) {
      for (const edge of cfg.succ.get(node) || []) {
        if (loopNodes.has(edge.to)) {
          if (edge.action.kind === 'assign' || edge.action.kind === 'decl') {
            modVars.add(edge.action.name);
          }
        }
      }
    }

    result.set(head, modVars);
  }

  return result;
}

/**
 * Soundness Verification Helper:
 * Verifies that the computed state assignment is indeed a post-fixpoint of the
 * abstract transition system: for every edge e: u -> v, transfer(e, S[u]) ⊑ S[v].
 */
export function checkPostFixpoint(
  cfg: CFG,
  states: Map<NodeId, AbstractState>
): boolean {
  for (const edge of cfg.edges) {
    const preState = states.get(edge.from);
    const postState = states.get(edge.to);
    if (!preState || !postState) return false;

    const out = transfer(edge, preState);
    if (!out.leq(postState)) {
      return false;
    }
  }
  return true;
}

/**
 * Fixed-Point Iteration Engine with Widening and Narrowing:
 *
 * Theoretical Structure:
 * 1. Ascending Phase with Widening (∇):
 *    Iterates along the CFG until convergence. To ensure termination over infinite-height
 *    intervals, loop heads delay widening by `wideningDelay` iterations to collect small
 *    local bounds, after which unstable bounds extrapolate to thresholds or ±∞.
 *
 * 2. Descending Phase with Narrowing (Δ):
 *    Post-fixpoints reached after widening can be over-approximated. The narrowing phase
 *    applies monotonic restriction: S_{k+1} = S_k Δ F(S_k). Because narrowing only replaces
 *    infinite bounds with finite ones, it monotonically recovers precision without risking
 *    infinite descent.
 */
export function solve(
  cfg: CFG,
  options: SolveOptions = {},
  obs?: Observer
): SolveResult {
  const isWideningOn = options.widening !== false;
  const isNarrowingOn = options.narrowing !== false;
  const wideningDelay = options.wideningDelay ?? 2;
  const narrowingRounds = options.narrowingRounds ?? 3;
  const maxIterations = options.maxIterations ?? 10000;
  const shouldRecordTrace = options.recordTrace ?? true;
  const thresholds = options.thresholds ? options.thresholdsList : undefined;

  const rpo = reversePostOrder(cfg);
  const rpoRank = new Map<NodeId, number>();
  rpo.forEach((id, idx) => rpoRank.set(id, idx));

  const loopHeadSet = new Set(cfg.loopHeads);
  const wideningPoints = new Set<NodeId>();
  const loopModVars = getLoopModifiedVars(cfg, rpoRank);

  // Initialize node states: entry is empty reachable, all others UNREACHABLE (⊥)
  const states = new Map<NodeId, AbstractState>();
  for (const node of cfg.nodes) {
    states.set(node.id, AbstractState.UNREACHABLE);
  }
  states.set(cfg.entry, AbstractState.empty());


  const worklist = new Set<NodeId>();
  worklist.add(cfg.entry);

  const visits = new Map<NodeId, number>();
  for (const node of cfg.nodes) {
    visits.set(node.id, 0);
  }

  const trace: TraceStep[] = [];
  let ascendingIterations = 0;
  let traceStepCount = 0;
  let terminated = true;

  // -------------------------------------------------------------------------
  // 1. Ascending Phase (Fixed-Point with Widening)
  // -------------------------------------------------------------------------

  while (worklist.size > 0) {
    ascendingIterations++;
    if (ascendingIterations > maxIterations) {
      terminated = false;
      break;
    }

    // Deterministic priority queue: pop lowest RPO rank
    let minNode: NodeId | undefined;
    let minRank = Infinity;
    for (const nodeId of worklist) {
      const rank = rpoRank.get(nodeId) ?? Infinity;
      if (rank < minRank) {
        minRank = rank;
        minNode = nodeId;
      }
    }

    if (minNode === undefined) break;
    worklist.delete(minNode);

    const currState = states.get(minNode)!;
    const outEdges = cfg.succ.get(minNode) || [];

    for (const edge of outEdges) {
      const target = edge.to;
      const targetState = states.get(target)!;

      // Transfer across edge
      const edgePostState = transfer(edge, currState, obs);

      let nextState: AbstractState;
      let appliedWidening = false;

      const isLoopHead = loopHeadSet.has(target);

      if (isLoopHead && isWideningOn) {
        const visitCount = (visits.get(target) ?? 0) + 1;
        visits.set(target, visitCount);

        const joined = targetState.join(edgePostState);

        if (visitCount > wideningDelay) {
          // Apply widening operator (restricted to variables modified in this loop)
          const filterVars = loopModVars.get(target);
          nextState = widenState(targetState, joined, thresholds, filterVars);
          appliedWidening = !nextState.equals(targetState);
          if (appliedWidening) {
            wideningPoints.add(target);
          }
        } else {
          // Delay phase: plain join
          nextState = joined;
        }
      } else {
        // Standard forward join
        nextState = targetState.join(edgePostState);
      }

      if (!nextState.equals(targetState)) {
        traceStepCount++;
        const oldState = targetState;
        states.set(target, nextState);
        worklist.add(target);

        if (shouldRecordTrace) {
          trace.push({
            iteration: traceStepCount,
            node: target,
            edgeId: edge.id,
            oldState,
            newState: nextState,
            widened: appliedWidening,
            phase: 'ascending',
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Descending Phase (Narrowing Phase)
  //
  // Theory: After widening, the post-fixpoint may be overly imprecise.
  // Narrowing recovers precision by iteratively tightening infinite bounds.
  //
  // Loop-Invariant Variable Fix:
  // At a loop head H, variables NOT modified in H's loop body are loop-invariant.
  // Their value at H is fully determined by the loop's entry edges (non-back-edges).
  // Using only entry contributions for these variables breaks a circular dependency
  // where back-edges perpetuate ±∞ from the widening phase. This is sound because
  // loop-invariant variables cannot change within the loop, so the back-edge
  // contribution is strictly redundant for them.
  // -------------------------------------------------------------------------

  let narrowingIterations = 0;

   if (terminated && isWideningOn && isNarrowingOn && narrowingRounds > 0) {
    // Precompute loop body nodes for each loop head, using RPO ranking
    // to correctly identify back edges.
    // A back edge to loop head H is an incoming edge from a node with a
    // higher RPO rank (later in topological order), indicating it loops back.
    const loopBodyNodes = new Map<NodeId, Set<NodeId>>();
    for (const head of cfg.loopHeads) {
      const body = new Set<NodeId>();
      body.add(head);

      const headRank = rpoRank.get(head) ?? 0;
      const inEdges = cfg.pred.get(head) || [];

      // Back-edge predecessors: nodes that appear after the loop head in RPO
      const backPreds = inEdges
        .filter((e) => (rpoRank.get(e.from) ?? 0) > headRank)
        .map((e) => e.from);

      // Flood-fill backward from back-edge predecessors to find loop body
      const queue: NodeId[] = [];
      for (const bp of backPreds) {
        if (!body.has(bp)) {
          body.add(bp);
          queue.push(bp);
        }
      }
      while (queue.length > 0) {
        const u = queue.shift()!;
        for (const predEdge of cfg.pred.get(u) || []) {
          const v = predEdge.from;
          if (v !== head && !body.has(v)) {
            body.add(v);
            queue.push(v);
          }
        }
      }
      loopBodyNodes.set(head, body);
    }

    for (let round = 0; round < narrowingRounds; round++) {
      narrowingIterations++;
      let roundChanged = false;

      // Evaluate nodes in topological (RPO) order
      for (const nodeId of rpo) {
        if (nodeId === cfg.entry) continue;

        const incomingEdges = cfg.pred.get(nodeId) || [];
        let newIn = AbstractState.UNREACHABLE;

        for (const inEdge of incomingEdges) {
          const predState = states.get(inEdge.from)!;
          const trans = transfer(inEdge, predState, obs);
          newIn = newIn.join(trans);
        }

        const currentState = states.get(nodeId)!;
        const isLoopHead = loopHeadSet.has(nodeId);

        let narrowed: AbstractState;

        if (isLoopHead) {
          // Compute entry-only contribution (non-back-edge predecessors)
          // for loop-invariant variables.
          const body = loopBodyNodes.get(nodeId)!;
          const modVars = loopModVars.get(nodeId) || new Set<string>();

          let entryOnly = AbstractState.UNREACHABLE;
          for (const inEdge of incomingEdges) {
            // A back edge comes from a node inside the loop body
            if (body.has(inEdge.from)) continue;
            const predState = states.get(inEdge.from)!;
            const trans = transfer(inEdge, predState, obs);
            entryOnly = entryOnly.join(trans);
          }

          // Build the narrowing input: for loop-modified variables, use the
          // full join (newIn); for loop-invariant variables, use only the
          // entry contribution which breaks the circular dependency.
          const allVars = new Set([
            ...currentState.getVars().keys(),
            ...newIn.getVars().keys(),
          ]);

          const mergedVars: Record<string, import('../domain/interval').Interval> = {};
          for (const v of allVars) {
            if (modVars.has(v)) {
              mergedVars[v] = newIn.get(v);
            } else {
              // Loop-invariant: use entry-only value (tighter, no back-edge pollution)
              mergedVars[v] = entryOnly.isUnreachable() ? newIn.get(v) : entryOnly.get(v);
            }
          }

          const mergedArrays = Object.fromEntries([
            ...currentState.getArrays(),
            ...newIn.getArrays(),
          ]);
          const narrowInput = AbstractState.of(mergedVars, mergedArrays);

          narrowed = narrowState(currentState, narrowInput);
        } else {
          narrowed = newIn;
        }

        if (!narrowed.equals(currentState)) {
          roundChanged = true;
          traceStepCount++;
          states.set(nodeId, narrowed);

          if (shouldRecordTrace) {
            trace.push({
              iteration: traceStepCount,
              node: nodeId,
              edgeId: -1,
              oldState: currentState,
              newState: narrowed,
              widened: false,
              phase: 'narrowing',
            });
          }
        }
      }

      // Early stop if narrowing stabilized
      if (!roundChanged) {
        break;
      }
    }
  }

  return {
    states,
    trace,
    terminated,
    iterations: ascendingIterations + narrowingIterations,
    ascendingIterations,
    narrowingIterations,
    wideningPoints,
  };
}
