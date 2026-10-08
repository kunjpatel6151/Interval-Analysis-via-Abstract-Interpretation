import { describe, it, expect } from 'vitest';
import { Lexer } from '../core/lexer';
import { Parser } from '../core/parser';
import {
  buildCFG,
  reversePostOrder,
  backEdges,
  toDot,
  prettyPrint,
  CFG,
} from '../cfg';

function parseAndBuild(code: string): CFG {
  const tokens = new Lexer(code).tokenize();
  const program = new Parser(tokens).parse();
  return buildCFG(program);
}

describe('Control Flow Graph (CFG) Construction', () => {
  it('straight-line program forms a sequential chain of nodes with no loop heads', () => {
    const code = `
      int x = 1;
      int y = x + 2;
      x = y * 3;
    `;
    const cfg = parseAndBuild(code);

    expect(cfg.loopHeads).toHaveLength(0);
    expect(backEdges(cfg)).toHaveLength(0);

    // Each node from entry to exit has 1 successor (except exit)
    let curr = cfg.entry;
    let visitedCount = 1;
    while (curr !== cfg.exit) {
      const succs = cfg.succ.get(curr) || [];
      expect(succs).toHaveLength(1);
      curr = succs[0].to;
      visitedCount++;
    }
    expect(visitedCount).toBe(cfg.nodes.length);
  });

  it('if without else has 2 successors from branch node and 2 predecessors into join node', () => {
    const code = `
      int x = input(0, 10);
      if (x < 5) {
        x = x + 1;
      }
      int z = x;
    `;
    const cfg = parseAndBuild(code);

    expect(cfg.loopHeads).toHaveLength(0);
    // Find the branch node (the node with 2 successors)
    const branchNodes = cfg.nodes.filter((n) => (cfg.succ.get(n.id) || []).length === 2);
    expect(branchNodes).toHaveLength(1);
    const branchId = branchNodes[0].id;
    const branchSuccs = cfg.succ.get(branchId)!;

    // One assume is non-negated, one is negated
    const assumeTrue = branchSuccs.find((e) => e.action.kind === 'assume' && !e.action.negated);
    const assumeFalse = branchSuccs.find((e) => e.action.kind === 'assume' && e.action.negated);
    expect(assumeTrue).toBeDefined();
    expect(assumeFalse).toBeDefined();

    // The join node has 2 predecessors: thenExit and branchId directly
    const joinNodes = cfg.nodes.filter((n) => (cfg.pred.get(n.id) || []).length === 2);
    expect(joinNodes).toHaveLength(1);
    const joinId = joinNodes[0].id;
    expect(assumeFalse!.to).toBe(joinId);
  });

  it('if/else routes both arms to the same join node', () => {
    const code = `
      int x = input(0, 10);
      int y = 0;
      if (x > 5) {
        y = 1;
      } else {
        y = 2;
      }
    `;
    const cfg = parseAndBuild(code);

    const branchNodes = cfg.nodes.filter((n) => (cfg.succ.get(n.id) || []).length === 2);
    expect(branchNodes).toHaveLength(1);

    // Both arms must converge on the same join node
    const joinNodes = cfg.nodes.filter((n) => (cfg.pred.get(n.id) || []).length === 2);
    expect(joinNodes).toHaveLength(1);
    const joinNode = joinNodes[0];

    // Both incoming edges to joinNode should be skips from the then and else blocks
    const incomingToJoin = cfg.pred.get(joinNode.id)!;
    expect(incomingToJoin).toHaveLength(2);
    expect(incomingToJoin.every((e) => e.action.kind === 'skip')).toBe(true);
  });

  it('while loop has exactly one loop head, one back edge, and exit edge with negated guard', () => {
    const code = `
      int i = 0;
      while (i < 100) {
        i = i + 1;
      }
    `;
    const cfg = parseAndBuild(code);

    expect(cfg.loopHeads).toHaveLength(1);
    const headId = cfg.loopHeads[0];
    const headNode = cfg.nodes.find((n) => n.id === headId);
    expect(headNode?.isLoopHead).toBe(true);

    // Check back edge
    const backs = backEdges(cfg);
    expect(backs).toHaveLength(1);
    expect(backs[0].to).toBe(headId);
    expect(backs[0].action.kind).toBe('skip');

    // Head node has 2 incoming edges (pre-loop skip + back-edge skip)
    const headPreds = cfg.pred.get(headId)!;
    expect(headPreds).toHaveLength(2);

    // Head node has 2 outgoing edges (assume true into body, assume false/negated out of loop)
    const headSuccs = cfg.succ.get(headId)!;
    expect(headSuccs).toHaveLength(2);
    const bodyEdge = headSuccs.find((e) => e.action.kind === 'assume' && !e.action.negated);
    const exitEdge = headSuccs.find((e) => e.action.kind === 'assume' && e.action.negated);
    expect(bodyEdge).toBeDefined();
    expect(exitEdge).toBeDefined();
    expect(exitEdge!.to).toBe(cfg.exit);
  });

  it('nested loops have two distinct loop heads, each with its own back edge', () => {
    const code = `
      int i = 0;
      while (i < 10) {
        int j = 0;
        while (j < 5) {
          j = j + 1;
        }
        i = i + 1;
      }
    `;
    const cfg = parseAndBuild(code);

    expect(cfg.loopHeads).toHaveLength(2);
    const backs = backEdges(cfg);
    expect(backs).toHaveLength(2);

    // Each back edge targets one of the loop heads
    const targetHeads = backs.map((e) => e.to).sort((a, b) => a - b);
    const expectedHeads = [...cfg.loopHeads].sort((a, b) => a - b);
    expect(targetHeads).toEqual(expectedHeads);
  });

  it('handles loop inside if, and if inside loop correctly', () => {
    const codeLoopInsideIf = `
      int x = input(0, 10);
      if (x > 5) {
        while (x > 0) {
          x = x - 1;
        }
      }
    `;
    const cfg1 = parseAndBuild(codeLoopInsideIf);
    expect(cfg1.loopHeads).toHaveLength(1);
    expect(backEdges(cfg1)).toHaveLength(1);

    const codeIfInsideLoop = `
      int i = 0;
      while (i < 10) {
        if (i == 5) {
          assert(i != 0);
        }
        i = i + 1;
      }
    `;
    const cfg2 = parseAndBuild(codeIfInsideLoop);
    expect(cfg2.loopHeads).toHaveLength(1);
    expect(backEdges(cfg2)).toHaveLength(1);
  });

  it('ensures every node is reachable from entry, and exit is reachable', () => {
    const code = `
      int a = 0;
      if (a < 2) {
        a = 1;
      } else {
        a = 2;
      }
      while (a > 0) {
        a = a - 1;
      }
    `;
    const cfg = parseAndBuild(code);

    // Forward reachability from entry using BFS
    const forwardReachable = new Set<number>();
    const qForward = [cfg.entry];
    forwardReachable.add(cfg.entry);
    while (qForward.length > 0) {
      const u = qForward.shift()!;
      for (const e of cfg.succ.get(u) || []) {
        if (!forwardReachable.has(e.to)) {
          forwardReachable.add(e.to);
          qForward.push(e.to);
        }
      }
    }
    expect(forwardReachable.size).toBe(cfg.nodes.length);

    // Backward reachability from exit
    const backwardReachable = new Set<number>();
    const qBackward = [cfg.exit];
    backwardReachable.add(cfg.exit);
    while (qBackward.length > 0) {
      const u = qBackward.shift()!;
      for (const e of cfg.pred.get(u) || []) {
        if (!backwardReachable.has(e.from)) {
          backwardReachable.add(e.from);
          qBackward.push(e.from);
        }
      }
    }
    expect(backwardReachable.size).toBe(cfg.nodes.length);
  });

  it('every edge has a valid source line number', () => {
    const code = `
      int x = 10;
      int y = 20;
      if (x < y) {
        y = y - 1;
      }
      while (y > 0) {
        y = y - 1;
      }
      assert(y == 0);
    `;
    const cfg = parseAndBuild(code);

    for (const edge of cfg.edges) {
      expect(edge.line).toBeGreaterThanOrEqual(1);
    }
  });

  it('computes reverse post order covering all nodes with loop heads visited', () => {
    const code = `
      int i = 0;
      while (i < 100) {
        i = i + 1;
      }
    `;
    const cfg = parseAndBuild(code);
    const rpo = reversePostOrder(cfg);

    expect(rpo).toHaveLength(cfg.nodes.length);
    expect(new Set(rpo).size).toBe(cfg.nodes.length);
    expect(rpo[0]).toBe(cfg.entry);
  });

  it('generates consistent Graphviz DOT output for while example', () => {
    const code = 'int i=0; while(i<100){i=i+1;}';
    const cfg = parseAndBuild(code);
    const dot = toDot(cfg);

    expect(dot).toContain('digraph CFG');
    expect(dot).toContain('[loop head]');
    expect(dot).toContain('[i < 100]');
    expect(dot).toContain('[!(i < 100)]');
    expect(dot).toContain('i = i + 1');
    expect(dot).toMatchSnapshot();
  });

  it('generates readable textual edge listing via prettyPrint', () => {
    const code = 'int x = 1; x = x + 1;';
    const cfg = parseAndBuild(code);
    const text = prettyPrint(cfg);

    expect(text).toContain('CFG (Entry: 0, Exit: 2');
    expect(text).toContain('N0 -> N1 : int x = 1');
    expect(text).toContain('N1 -> N2 : x = x + 1');
  });
});

