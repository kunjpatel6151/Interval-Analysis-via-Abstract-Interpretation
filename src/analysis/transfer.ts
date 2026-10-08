import { Edge } from '../cfg/types';
import { AbstractState } from '../domain/state';
import { constant, isBottom } from '../domain/interval';
import { evalExpr, Observer } from './eval';
import { refine } from './refine';

/**
 * Abstract Transfer Function:
 * Computes the post-state after executing the action on a CFG edge.
 *
 * transfer : (Edge, AbstractState) -> AbstractState
 */
export function transfer(
  edge: Edge,
  state: AbstractState,
  obs?: Observer
): AbstractState {
  // If the pre-state is unreachable, the post-state is strictly unreachable (dead code)
  if (state.isUnreachable()) {
    return AbstractState.UNREACHABLE;
  }

  const { action } = edge;

  switch (action.kind) {
    case 'skip':
      return state;

    case 'decl': {
      // Uninitialized variables default deterministically to 0, matching the interpreter.
      const val = action.init ? evalExpr(action.init, state, obs) : constant(0);
      if (isBottom(val)) {
        return AbstractState.UNREACHABLE;
      }
      return state.set(action.name, val);
    }

    case 'assign': {
      const val = evalExpr(action.expr, state, obs);
      if (isBottom(val)) {
        return AbstractState.UNREACHABLE;
      }
      return state.set(action.name, val);
    }

    case 'arrayDecl': {
      return state.setArraySize(action.name, action.size);
    }

    case 'store': {
      const idx = evalExpr(action.index, state, obs);
      if (isBottom(idx)) {
        return AbstractState.UNREACHABLE;
      }
      obs?.onIndex?.(edge.line, action.array, idx);

      const val = evalExpr(action.expr, state, obs);
      if (isBottom(val)) {
        return AbstractState.UNREACHABLE;
      }

      return state;
    }

    case 'assume': {
      // Restrict abstract state according to conditional guard
      return refine(action.cond, state, action.negated);
    }

    case 'assert': {
      // Analysis continues as if the assertion held.
      // (The checker in Phase 7 will evaluate the assertion against the pre-state).
      return refine(action.cond, state, false);
    }
  }
}
