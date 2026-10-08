import { Cond, Expr, CompareOp } from '../core/ast';
import { AbstractState } from '../domain/state';
import {
  Interval,
  isBottom,
  constant,
  add,
  sub,
  neg,
  refineLt,
  refineLe,
  refineGt,
  refineGe,
  refineEq,
  refineNe,
} from '../domain/interval';
import { evalExpr } from './eval';

/**
 * Pushes negation inward using De Morgan's laws and relation inversion.
 * Guarantees that the resulting condition has no top-level negation and
 * only contains CompareCond, BinaryCond (&&, ||).
 */
export function negate(cond: Cond): Cond {
  switch (cond.kind) {
    case 'NotCond':
      return cond.expr;

    case 'LogicalCond':
      if (cond.op === '&&') {
        return {
          kind: 'LogicalCond',
          op: '||',
          left: negate(cond.left),
          right: negate(cond.right),
          loc: cond.loc,
        };
      } else {
        return {
          kind: 'LogicalCond',
          op: '&&',
          left: negate(cond.left),
          right: negate(cond.right),
          loc: cond.loc,
        };
      }

    case 'CompareCond': {
      const invertedOp: Record<CompareOp, CompareOp> = {
        '<': '>=',
        '<=': '>',
        '>': '<=',
        '>=': '<',
        '==': '!=',
        '!=': '==',
      };
      return {
        kind: 'CompareCond',
        op: invertedOp[cond.op],
        left: cond.left,
        right: cond.right,
        loc: cond.loc,
      };
    }
  }
}

/**
 * Normalizes a condition by simplifying nested negations.
 */
function normalizeCond(cond: Cond): Cond {
  if (cond.kind === 'NotCond') {
    return negate(normalizeCond(cond.expr));
  }
  if (cond.kind === 'LogicalCond') {
    return {
      kind: 'LogicalCond',
      op: cond.op,
      left: normalizeCond(cond.left),
      right: normalizeCond(cond.right),
      loc: cond.loc,
    };
  }
  return cond;
}

/**
 * Returns the mirrored comparison operator for e2 op_mirrored e1.
 */
function mirrorOp(op: CompareOp): CompareOp {
  switch (op) {
    case '<':
      return '>';
    case '<=':
      return '>=';
    case '>':
      return '<';
    case '>=':
      return '<=';
    case '==':
      return '==';
    case '!=':
      return '!=';
  }
}

/**
 * Applies interval refinement for a comparison operator: e1 op e2.
 */
function refineComparisonBound(
  left: Interval,
  right: Interval,
  op: CompareOp
): Interval {
  switch (op) {
    case '<':
      return refineLt(left, right);
    case '<=':
      return refineLe(left, right);
    case '>':
      return refineGt(left, right);
    case '>=':
      return refineGe(left, right);
    case '==':
      return refineEq(left, right);
    case '!=':
      return refineNe(left, right);
  }
}

/**
 * Backward arithmetic refinement extension:
 * When an expression is of the form `v`, `v + c`, `c + v`, `v - c`, `c - v`, or `-v`,
 * inverts the linear arithmetic to refine variable `v` using target interval `T`.
 *
 * Soundness Note:
 * This backward refinement directly inverts monotonic affine transforms over ℤ.
 * For any unhandled complex expression (e.g. multiplication), it safely skips
 * backward projection, returning the state unchanged (sound over-approximation).
 */
function refineExprBackward(
  expr: Expr,
  target: Interval,
  state: AbstractState
): AbstractState {
  if (state.isUnreachable() || isBottom(target)) {
    return AbstractState.UNREACHABLE;
  }

  // Plain variable: x in target
  if (expr.kind === 'Var') {
    const current = state.get(expr.name);
    const refined = refineEq(current, target);
    if (isBottom(refined)) {
      return AbstractState.UNREACHABLE;
    }
    return state.set(expr.name, refined);
  }

  // Unary negation: -v in target  =>  v in -target
  if (expr.kind === 'Unary' && expr.op === '-' && expr.expr.kind === 'Var') {
    const varName = expr.expr.name;
    const current = state.get(varName);
    const refined = refineEq(current, neg(target));
    if (isBottom(refined)) {
      return AbstractState.UNREACHABLE;
    }
    return state.set(varName, refined);
  }

  // Linear addition & subtraction:
  if (expr.kind === 'Binary') {
    // v + c  =>  v in target - c
    if (expr.op === '+' && expr.left.kind === 'Var' && expr.right.kind === 'IntLiteral') {
      const varName = expr.left.name;
      const c = constant(expr.right.value);
      const refinedTarget = sub(target, c);
      const current = state.get(varName);
      const refined = refineEq(current, refinedTarget);
      if (isBottom(refined)) return AbstractState.UNREACHABLE;
      return state.set(varName, refined);
    }

    // c + v  =>  v in target - c
    if (expr.op === '+' && expr.left.kind === 'IntLiteral' && expr.right.kind === 'Var') {
      const varName = expr.right.name;
      const c = constant(expr.left.value);
      const refinedTarget = sub(target, c);
      const current = state.get(varName);
      const refined = refineEq(current, refinedTarget);
      if (isBottom(refined)) return AbstractState.UNREACHABLE;
      return state.set(varName, refined);
    }

    // v - c  =>  v in target + c
    if (expr.op === '-' && expr.left.kind === 'Var' && expr.right.kind === 'IntLiteral') {
      const varName = expr.left.name;
      const c = constant(expr.right.value);
      const refinedTarget = add(target, c);
      const current = state.get(varName);
      const refined = refineEq(current, refinedTarget);
      if (isBottom(refined)) return AbstractState.UNREACHABLE;
      return state.set(varName, refined);
    }

    // c - v  =>  v in c - target
    if (expr.op === '-' && expr.left.kind === 'IntLiteral' && expr.right.kind === 'Var') {
      const varName = expr.right.name;
      const c = constant(expr.left.value);
      const refinedTarget = sub(c, target);
      const current = state.get(varName);
      const refined = refineEq(current, refinedTarget);
      if (isBottom(refined)) return AbstractState.UNREACHABLE;
      return state.set(varName, refined);
    }
  }

  return state;
}

/**
 * Branch Refinement Function:
 * Refines the abstract state s assuming condition `cond` evaluates to true
 * (or false if `negated = true`).
 *
 * refine : (Cond, AbstractState, boolean) -> AbstractState
 */
export function refine(
  cond: Cond,
  state: AbstractState,
  negated = false
): AbstractState {
  if (state.isUnreachable()) {
    return AbstractState.UNREACHABLE;
  }

  // 1. Push negation inward via De Morgan's laws
  const normalized = negated ? negate(cond) : normalizeCond(cond);

  return refineNormalized(normalized, state);
}

function refineNormalized(cond: Cond, state: AbstractState): AbstractState {
  if (state.isUnreachable()) {
    return AbstractState.UNREACHABLE;
  }

  switch (cond.kind) {
    case 'NotCond':
      // normalizeCond already eliminates top-level negations, but handle just in case
      return refineNormalized(negate(cond.expr), state);

    case 'LogicalCond': {
      if (cond.op === '&&') {
        // Sequential refinement: s' = refine(left, s); refine(right, s')
        const s1 = refineNormalized(cond.left, state);
        if (s1.isUnreachable()) {
          return AbstractState.UNREACHABLE;
        }
        return refineNormalized(cond.right, s1);
      } else {
        // Conjunction join: refine(left, s) ⊔ refine(right, s)
        const sLeft = refineNormalized(cond.left, state);
        const sRight = refineNormalized(cond.right, state);
        return sLeft.join(sRight);
      }
    }

    case 'CompareCond': {
      // 1. Evaluate both expressions
      const i1 = evalExpr(cond.left, state);
      const i2 = evalExpr(cond.right, state);

      if (isBottom(i1) || isBottom(i2)) {
        return AbstractState.UNREACHABLE;
      }

      // 2. Refine left and right interval bounds
      const refinedLeft = refineComparisonBound(i1, i2, cond.op);
      const refinedRight = refineComparisonBound(i2, i1, mirrorOp(cond.op));

      if (isBottom(refinedLeft) || isBottom(refinedRight)) {
        return AbstractState.UNREACHABLE;
      }

      // 3. Update variable environments through backward projection
      let updatedState = state;
      updatedState = refineExprBackward(cond.left, refinedLeft, updatedState);
      if (updatedState.isUnreachable()) {
        return AbstractState.UNREACHABLE;
      }

      updatedState = refineExprBackward(cond.right, refinedRight, updatedState);
      return updatedState;
    }
  }
}
