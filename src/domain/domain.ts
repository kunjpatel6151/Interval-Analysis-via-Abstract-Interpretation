import {
  Interval,
  Bound,
  BOTTOM,
  TOP,
  constant,
  range,
  join,
  meet,
  leq,
  equals,
  add,
  sub,
  mul,
  neg,
  div,
  widen,
  narrow,
  refineLt,
  refineLe,
  refineGt,
  refineGe,
  refineEq,
  refineNe,
  intervalToString,
  DivResult,
} from './interval';

/**
 * Generic Domain interface representing an abstract domain in abstract interpretation.
 * Allows plug-and-play modularity across different numerical domains (Intervals, Signs, Constants).
 */
export interface Domain<T> {
  bottom: T;
  top: T;
  fromConst(n: number): T;
  fromRange(lo: Bound, hi: Bound): T;

  // Lattice operations
  join(a: T, b: T): T;
  meet(a: T, b: T): T;
  leq(a: T, b: T): boolean;
  equals(a: T, b: T): boolean;

  // Abstract arithmetic
  add(a: T, b: T): T;
  sub(a: T, b: T): T;
  mul(a: T, b: T): T;
  neg(a: T): T;
  div(a: T, b: T): { result: T; mayDivZero: boolean; mustDivZero: boolean };

  // Convergence acceleration and precision recovery
  widen(oldVal: T, newVal: T): T;
  narrow(oldVal: T, newVal: T): T;

  // Branch condition refinements
  refineLt(x: T, e: T): T;
  refineLe(x: T, e: T): T;
  refineGt(x: T, e: T): T;
  refineGe(x: T, e: T): T;
  refineEq(x: T, e: T): T;
  refineNe(x: T, e: T): T;

  // Human-readable string representation
  toString(val: T): string;
}

/**
 * Concrete instantiation of Domain for the Interval Domain.
 */
export const IntervalDomain: Domain<Interval> = {
  bottom: BOTTOM,
  top: TOP,
  fromConst: constant,
  fromRange: range,

  join,
  meet,
  leq,
  equals,

  add,
  sub,
  mul,
  neg,
  div: (a: Interval, b: Interval): DivResult => div(a, b),

  widen,
  narrow,

  refineLt,
  refineLe,
  refineGt,
  refineGe,
  refineEq,
  refineNe,

  toString: intervalToString,
};
