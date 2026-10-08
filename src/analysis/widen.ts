import { Program, Stmt, Expr, Cond } from '../core/ast';
import { AbstractState } from '../domain/state';
import {
  Interval,
  widen as intervalWiden,
  widenWithThresholds as intervalWidenWithThresholds,
  narrow as intervalNarrow,
} from '../domain/interval';

/**
 * Theory Note on Widening Location:
 * In abstract interpretation, widening is applied ONLY at a feedback vertex set
 * of the CFG—in our case, the dedicated loop heads.
 *
 * Why loop heads suffice:
 * Every cyclic execution path in the program must traverse at least one loop head.
 * Applying the widening operator (∇) at loop heads cuts every infinite ascending
 * chain in the CFG, guaranteeing convergence in finite steps while preserving full
 * transfer precision at all forward (acyclic) nodes.
 *
 * Loop-Variant Variable Restriction:
 * Furthermore, at a loop head H, widening is applied only to variables modified
 * within the natural loop of H. Variables declared or modified outside H are loop-invariant
 * with respect to H; widening them at H would cause "widening pollution" where outer
 * variables diverge prematurely in nested loops.
 */

/**
 * Harvests threshold constants from the AST:
 * Collects every integer literal c in the source code, plus c - 1 and c + 1
 * (to anticipate loop boundaries and off-by-one comparisons), plus 0,
 * and declared array sizes with size - 1.
 */
export function collectThresholds(ast: Program): number[] {
  const set = new Set<number>();
  set.add(0);
  set.add(-1);
  set.add(1);

  function addVal(n: number) {
    if (Number.isFinite(n)) {
      set.add(n);
      set.add(n - 1);
      set.add(n + 1);
    }
  }

  function walkExpr(e: Expr) {
    switch (e.kind) {
      case 'IntLiteral':
        addVal(e.value);
        break;
      case 'Input':
        addVal(e.min);
        addVal(e.max);
        break;
      case 'Unary':
        walkExpr(e.expr);
        break;
      case 'Binary':
        walkExpr(e.left);
        walkExpr(e.right);
        break;
      case 'ArrayAccess':
        walkExpr(e.index);
        break;
      case 'Var':
        break;
    }
  }

  function walkCond(c: Cond) {
    switch (c.kind) {
      case 'CompareCond':
        walkExpr(c.left);
        walkExpr(c.right);
        break;
      case 'LogicalCond':
        walkCond(c.left);
        walkCond(c.right);
        break;
      case 'NotCond':
        walkCond(c.expr);
        break;
    }
  }

  function walkStmt(s: Stmt) {
    switch (s.kind) {
      case 'VarDecl':
        if (s.init) walkExpr(s.init);
        break;
      case 'ArrayDecl':
        addVal(s.size);
        addVal(s.size - 1);
        break;
      case 'Assign':
        walkExpr(s.value);
        break;
      case 'ArrayStore':
        walkExpr(s.index);
        walkExpr(s.value);
        break;
      case 'If':
        walkCond(s.cond);
        s.thenBlock.stmts.forEach(walkStmt);
        s.elseBlock?.stmts.forEach(walkStmt);
        break;
      case 'While':
        walkCond(s.cond);
        s.body.stmts.forEach(walkStmt);
        break;
      case 'Assert':
        walkCond(s.cond);
        break;
      case 'Block':
        s.stmts.forEach(walkStmt);
        break;
    }
  }

  ast.stmts.forEach(walkStmt);
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Pointwise state widening:
 * Computes oldState ∇ newState.
 * If filterVars is provided, only variables in filterVars are widened;
 * loop-invariant variables take the joined value without widening.
 */
export function widenState(
  oldState: AbstractState,
  newState: AbstractState,
  thresholds?: number[],
  filterVars?: Set<string>
): AbstractState {
  if (oldState.isUnreachable()) return newState;
  if (newState.isUnreachable()) return oldState;

  const allKeys = new Set([...oldState.getVars().keys(), ...newState.getVars().keys()]);
  const resultVars = new Map<string, Interval>();

  for (const key of allKeys) {
    const vOld = oldState.get(key);
    const vNew = newState.get(key);

    if (filterVars && !filterVars.has(key)) {
      resultVars.set(key, vNew);
      continue;
    }

    const widened = thresholds && thresholds.length > 0
      ? intervalWidenWithThresholds(vOld, vNew, thresholds)
      : intervalWiden(vOld, vNew);

    resultVars.set(key, widened);
  }

  const mergedArrays = new Map([...oldState.getArrays(), ...newState.getArrays()]);
  return AbstractState.of(Object.fromEntries(resultVars), Object.fromEntries(mergedArrays));
}

/**
 * Pointwise state narrowing:
 * Computes oldState Δ newState.
 * Replaces infinite bounds in oldState with tighter finite bounds from newState,
 * recovering precision after loop convergence while guaranteeing termination.
 */
export function narrowState(
  oldState: AbstractState,
  newState: AbstractState
): AbstractState {
  if (oldState.isUnreachable()) return oldState;
  if (newState.isUnreachable()) return newState;

  const allKeys = new Set([...oldState.getVars().keys(), ...newState.getVars().keys()]);
  const resultVars = new Map<string, Interval>();

  for (const key of allKeys) {
    const vOld = oldState.get(key);
    const vNew = newState.get(key);
    resultVars.set(key, intervalNarrow(vOld, vNew));
  }

  const mergedArrays = new Map([...oldState.getArrays(), ...newState.getArrays()]);
  return AbstractState.of(Object.fromEntries(resultVars), Object.fromEntries(mergedArrays));
}
