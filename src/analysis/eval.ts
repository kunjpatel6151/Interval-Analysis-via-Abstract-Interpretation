import { Expr } from '../core/ast';
import { AbstractState } from '../domain/state';
import {
  Interval,
  BOTTOM,
  TOP,
  constant,
  range,
  add,
  sub,
  neg,
  mul,
  div,
  isBottom,
} from '../domain/interval';

/**
 * Observer callback interface used by the static analysis checker to record
 * potential division-by-zero, array-out-of-bounds, and integer overflow points.
 * Keeping this as an optional observer decouples expression evaluation from reporting.
 */
export interface Observer {
  onDiv?(line: number, divisor: Interval, result: Interval, divisorExpr?: Expr): void;
  onIndex?(line: number, array: string, index: Interval): void;
  onArith?(line: number, op: string, result: Interval, expr?: Expr): void;
}

/**
 * Abstract expression evaluator:
 * Evaluates an AST expression over an abstract state in the interval lattice.
 *
 * NOTE ON ARITHMETIC:
 * All arithmetic operators (+, -, *, /) are computed over idealized MATHEMATICAL
 * integers (ℤ ∪ {-∞, +∞}) with NO wraparound. Overflow is detected separately in
 * the checker by testing whether the evaluated interval lies within the Int32 bounds.
 *
 * NOTE ON ARRAYS:
 * In this interval domain, arrays are modeled as weak summary locations: indexing
 * a[i] evaluates the index expression for bounds verification, notifies the observer,
 * and returns TOP ([-∞, +∞]) as per-element array value tracking is not performed.
 */
export function evalExpr(
  expr: Expr,
  state: AbstractState,
  obs?: Observer
): Interval {
  if (state.isUnreachable()) {
    return BOTTOM;
  }

  switch (expr.kind) {
    case 'IntLiteral':
      return constant(expr.value);

    case 'Var':
      // Missing variable soundly defaults to TOP
      return state.get(expr.name);

    case 'Input':
      return range(expr.min, expr.max);

    case 'ArrayAccess': {
      const idx = evalExpr(expr.index, state, obs);
      if (isBottom(idx)) {
        return BOTTOM;
      }
      obs?.onIndex?.(expr.loc.line, expr.name, idx);
      // Weak array summary: values inside the array are unconstrained TOP
      return TOP;
    }

    case 'Unary': {
      if (expr.op === '-') {
        const inner = evalExpr(expr.expr, state, obs);
        if (isBottom(inner)) {
          return BOTTOM;
        }
        const res = neg(inner);
        obs?.onArith?.(expr.loc.line, '-', res, expr);
        return res;
      }
      return BOTTOM;
    }

    case 'Binary': {
      const left = evalExpr(expr.left, state, obs);
      if (isBottom(left)) {
        return BOTTOM;
      }
      const right = evalExpr(expr.right, state, obs);
      if (isBottom(right)) {
        return BOTTOM;
      }

      switch (expr.op) {
        case '+': {
          const res = add(left, right);
          obs?.onArith?.(expr.loc.line, '+', res, expr);
          return res;
        }
        case '-': {
          const res = sub(left, right);
          obs?.onArith?.(expr.loc.line, '-', res, expr);
          return res;
        }
        case '*': {
          const res = mul(left, right);
          obs?.onArith?.(expr.loc.line, '*', res, expr);
          return res;
        }
        case '/': {
          const divRes = div(left, right);
          obs?.onDiv?.(expr.loc.line, right, divRes.result, expr.right);
          if (divRes.mustDivZero) {
            return BOTTOM;
          }
          return divRes.result;
        }
      }
    }
  }
}
