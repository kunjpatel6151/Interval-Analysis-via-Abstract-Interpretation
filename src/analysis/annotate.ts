import { AnalysisResult } from './analyze';
import { AbstractState } from '../domain/state';
import { intervalToString, equals } from '../domain/interval';
import { Severity, lineSeverity } from './checker';
import { Expr, Cond } from '../core/ast';
import { Edge } from '../cfg/types';

export interface VarAnnotation {
  name: string;
  interval: string;
  changed: boolean;
}

export interface LineAnnotation {
  line: number;
  vars: VarAnnotation[];
  reachable: boolean;
  severity: Severity | 'none';
}

/**
 * Collects variable names referenced or modified in an expression.
 */
function collectExprVars(expr: Expr, out: Set<string>): void {
  switch (expr.kind) {
    case 'Var':
      out.add(expr.name);
      break;
    case 'ArrayAccess':
      out.add(expr.name);
      collectExprVars(expr.index, out);
      break;
    case 'Unary':
      collectExprVars(expr.expr, out);
      break;
    case 'Binary':
      collectExprVars(expr.left, out);
      collectExprVars(expr.right, out);
      break;
    case 'IntLiteral':
    case 'Input':
      break;
  }
}

/**
 * Collects variable names referenced in a condition.
 */
function collectCondVars(cond: Cond, out: Set<string>): void {
  switch (cond.kind) {
    case 'CompareCond':
      collectExprVars(cond.left, out);
      collectExprVars(cond.right, out);
      break;
    case 'NotCond':
      collectCondVars(cond.expr, out);
      break;
    case 'LogicalCond':
      collectCondVars(cond.left, out);
      collectCondVars(cond.right, out);
      break;
  }
}

/**
 * Computes line-by-line annotations from an AnalysisResult.
 * UI-free core helper function.
 */
export function lineAnnotations(result: AnalysisResult): Map<number, LineAnnotation> {
  const map = new Map<number, LineAnnotation>();

  if (!result.cfg || !result.solve) {
    return map;
  }

  const { cfg, solve, check } = result;

  // Group edges by line number
  const edgesByLine = new Map<number, Edge[]>();
  for (const edge of cfg.edges) {
    if (edge.line <= 0) continue;
    const list = edgesByLine.get(edge.line) || [];
    list.push(edge);
    edgesByLine.set(edge.line, list);
  }

  for (const [line, edges] of edgesByLine.entries()) {
    // Sort edges on this line by ID
    const sortedEdges = [...edges].sort((a, b) => a.id - b.id);

    // Identify mentioned variables for this line
    const mentionedVars = new Set<string>();
    let hasAssumeEdge = false;
    let assumeEdge: Edge | null = null;

    for (const edge of sortedEdges) {
      const { action } = edge;
      switch (action.kind) {
        case 'decl':
          mentionedVars.add(action.name);
          if (action.init) collectExprVars(action.init, mentionedVars);
          break;
        case 'assign':
          mentionedVars.add(action.name);
          collectExprVars(action.expr, mentionedVars);
          break;
        case 'store':
          collectExprVars(action.index, mentionedVars);
          collectExprVars(action.expr, mentionedVars);
          break;
        case 'assume':
          hasAssumeEdge = true;
          assumeEdge = edge;
          collectCondVars(action.cond, mentionedVars);
          break;
        case 'assert':
          collectCondVars(action.cond, mentionedVars);
          break;
      }
    }

    // Determine Pre-state and Post-state for line annotation:
    // Pre-state: state at entry of first edge on this line
    const preState = solve.states.get(sortedEdges[0].from) || AbstractState.UNREACHABLE;

    // Post-state:
    // For if/while lines (with assume edges), post-state is the state at the branch node / loop head (the state the condition sees)
    // For normal lines, post-state is the state at the `to` node of the last edge on this line.
    let postState: AbstractState;
    if (hasAssumeEdge && assumeEdge) {
      postState = solve.states.get(assumeEdge.from) || AbstractState.UNREACHABLE;
    } else {
      const lastEdge = sortedEdges[sortedEdges.length - 1];
      postState = solve.states.get(lastEdge.to) || AbstractState.UNREACHABLE;
    }

    const reachable = !postState.isUnreachable();

    // Build variable annotations for mentioned variables
    const varList: VarAnnotation[] = [];
    const sortedVarNames = Array.from(mentionedVars).sort();

    for (const v of sortedVarNames) {
      const preInv = preState.get(v);
      const postInv = postState.get(v);

      const changed = !equals(preInv, postInv);
      const interval = intervalToString(postInv);

      varList.push({
        name: v,
        interval,
        changed,
      });
    }

    // Determine severity: "none" if no findings for this line, else lineSeverity
    let severity: Severity | 'none' = 'none';
    if (check) {
      const lineFindings = check.findings.filter((f) => f.line === line);
      if (lineFindings.length > 0) {
        severity = lineSeverity(check, line);
      }
    }

    map.set(line, {
      line,
      vars: varList,
      reachable,
      severity,
    });
  }

  return map;
}
