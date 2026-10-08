import { CFG, Edge, NodeId } from './types';

/**
 * Computes a Reverse Post-Order (RPO) ordering of the CFG nodes.
 * In forward data-flow analysis and fixed-point iteration, RPO ensures that
 * in the acyclic portions of the CFG, all predecessors of a node are visited
 * before the node itself, minimizing the number of worklist iterations.
 */
export function reversePostOrder(cfg: CFG): NodeId[] {
  const visited = new Set<NodeId>();
  const postOrder: NodeId[] = [];

  function dfs(nodeId: NodeId) {
    visited.add(nodeId);
    const edges = cfg.succ.get(nodeId) || [];
    for (const edge of edges) {
      if (!visited.has(edge.to)) {
        dfs(edge.to);
      }
    }
    postOrder.push(nodeId);
  }

  dfs(cfg.entry);

  // If there are disconnected nodes for any reason, process them as well
  for (const node of cfg.nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id);
    }
  }

  return postOrder.reverse();
}

/**
 * Identifies back edges in the CFG using a standard 3-color DFS.
 * An edge (u -> v) is a back edge if v is currently on the active recursion stack
 * (an ancestor in the DFS spanning tree), signifying a loop cycle.
 */
export function backEdges(cfg: CFG): Edge[] {
  const State = {
    UNVISITED: 0,
    VISITING: 1, // On active recursion stack
    VISITED: 2,
  };

  const state = new Map<NodeId, number>();
  for (const node of cfg.nodes) {
    state.set(node.id, State.UNVISITED);
  }

  const result: Edge[] = [];

  function dfs(u: NodeId) {
    state.set(u, State.VISITING);
    const edges = cfg.succ.get(u) || [];
    for (const edge of edges) {
      const v = edge.to;
      const vState = state.get(v);
      if (vState === State.VISITING) {
        // v is an active ancestor -> back edge
        result.push(edge);
      } else if (vState === State.UNVISITED) {
        dfs(v);
      }
    }
    state.set(u, State.VISITED);
  }

  dfs(cfg.entry);

  return result;
}
