/**
 * Bound type for Interval domain: an integer, -Infinity, or +Infinity.
 */
export type Bound = number;

/**
 * Representation of an Interval in the abstract domain:
 * Either bottom ⊥ (unreachable / empty set) or a closed interval [lo, hi].
 */
export type Interval =
  | { bottom: true }
  | { bottom: false; lo: Bound; hi: Bound };

export const INT32_MIN = -2147483648;
export const INT32_MAX = 2147483647;

// ---------------------------------------------------------------------------
// Constructors & Inspection
// ---------------------------------------------------------------------------

export const BOTTOM: Interval = Object.freeze({ bottom: true });
export const TOP: Interval = Object.freeze({ bottom: false, lo: -Infinity, hi: Infinity });

/**
 * Constructs an Interval [lo, hi].
 * Normalizes invalid intervals (lo > hi or NaN) to BOTTOM so that invalid
 * states can never exist in the system.
 */
export function range(lo: Bound, hi: Bound): Interval {
  if (Number.isNaN(lo) || Number.isNaN(hi) || lo > hi) {
    return BOTTOM;
  }
  // Normalize -0 to 0
  const normalizedLo = lo === 0 ? 0 : lo;
  const normalizedHi = hi === 0 ? 0 : hi;
  return { bottom: false, lo: normalizedLo, hi: normalizedHi };
}

export function constant(n: number): Interval {
  return range(n, n);
}

export function isBottom(i: Interval): boolean {
  return i.bottom;
}

export function isTop(i: Interval): boolean {
  return !i.bottom && i.lo === -Infinity && i.hi === Infinity;
}

export function contains(i: Interval, n: number): boolean {
  if (i.bottom) return false;
  return n >= i.lo && n <= i.hi;
}

export function isSingleton(i: Interval): boolean {
  return !i.bottom && i.lo === i.hi && Number.isFinite(i.lo);
}

export function equals(a: Interval, b: Interval): boolean {
  if (a.bottom && b.bottom) return true;
  if (a.bottom || b.bottom) return false;
  return a.lo === b.lo && a.hi === b.hi;
}

// ---------------------------------------------------------------------------
// Lattice Operations
// ---------------------------------------------------------------------------

/**
 * Partial order (interval inclusion): a ⊑ b.
 * BOTTOM is the least element (⊥ ⊑ b for all b).
 */
export function leq(a: Interval, b: Interval): boolean {
  if (a.bottom) return true;
  if (b.bottom) return false;
  return a.lo >= b.lo && a.hi <= b.hi;
}

/**
 * Lattice Join (⊔): least upper bound.
 * BOTTOM is the identity element.
 */
export function join(a: Interval, b: Interval): Interval {
  if (a.bottom) return b;
  if (b.bottom) return a;
  return range(Math.min(a.lo, b.lo), Math.max(a.hi, b.hi));
}

/**
 * Lattice Meet (⊓): greatest lower bound (intersection).
 * Returns BOTTOM if intersection is empty.
 */
export function meet(a: Interval, b: Interval): Interval {
  if (a.bottom || b.bottom) return BOTTOM;
  const newLo = Math.max(a.lo, b.lo);
  const newHi = Math.min(a.hi, b.hi);
  return range(newLo, newHi);
}

// ---------------------------------------------------------------------------
// Arithmetic Operations (Strict in BOTTOM)
// ---------------------------------------------------------------------------

export function add(a: Interval, b: Interval): Interval {
  if (a.bottom || b.bottom) return BOTTOM;
  return range(a.lo + b.lo, a.hi + b.hi);
}

export function sub(a: Interval, b: Interval): Interval {
  if (a.bottom || b.bottom) return BOTTOM;
  return range(a.lo - b.hi, a.hi - b.lo);
}

export function neg(a: Interval): Interval {
  if (a.bottom) return BOTTOM;
  return range(-a.hi, -a.lo);
}

/**
 * Helper to compute multiplication between bounds without producing NaN.
 * In abstract interpretation of intervals, 0 * ±∞ is defined as 0 because
 * the set {0} * ℝ = {0}.
 */
function safeMul(x: Bound, y: Bound): Bound {
  if (x === 0 || y === 0) return 0;
  return x * y;
}

/**
 * Interval multiplication: [min of 4 products, max of 4 products].
 */
export function mul(a: Interval, b: Interval): Interval {
  if (a.bottom || b.bottom) return BOTTOM;
  const p1 = safeMul(a.lo, b.lo);
  const p2 = safeMul(a.lo, b.hi);
  const p3 = safeMul(a.hi, b.lo);
  const p4 = safeMul(a.hi, b.hi);
  return range(Math.min(p1, p2, p3, p4), Math.max(p1, p2, p3, p4));
}

/**
 * Helper for integer division truncating toward zero (Math.trunc).
 * Division by ±∞ evaluates to 0.
 */
function safeDiv(num: Bound, den: Bound): Bound {
  if (den === Infinity || den === -Infinity) return 0;
  if (num === Infinity) return den > 0 ? Infinity : -Infinity;
  if (num === -Infinity) return den > 0 ? -Infinity : Infinity;
  const q = Math.trunc(num / den);
  return q === 0 ? 0 : q;
}

export interface DivResult {
  result: Interval;
  mayDivZero: boolean;
  mustDivZero: boolean;
}

/**
 * Interval integer division:
 * Truncates towards zero. If the divisor spans 0, it must be split into
 * negative part [-∞, -1] and positive part [1, +∞] to avoid undefined division
 * and accurately compute the extremal bounds of the resulting quotient sets.
 */
export function div(a: Interval, b: Interval): DivResult {
  if (a.bottom || b.bottom) {
    return { result: BOTTOM, mayDivZero: false, mustDivZero: false };
  }

  const mayDivZero = contains(b, 0);
  const mustDivZero = isSingleton(b) && b.lo === 0;

  if (mustDivZero) {
    return { result: BOTTOM, mayDivZero: true, mustDivZero: true };
  }

  // Split divisor into negative and positive parts
  const bNeg = meet(b, range(-Infinity, -1));
  const bPos = meet(b, range(1, Infinity));

  const partResults: Interval[] = [];

  for (const part of [bNeg, bPos]) {
    if (!part.bottom) {
      const q1 = safeDiv(a.lo, part.lo);
      const q2 = safeDiv(a.lo, part.hi);
      const q3 = safeDiv(a.hi, part.lo);
      const q4 = safeDiv(a.hi, part.hi);
      partResults.push(range(Math.min(q1, q2, q3, q4), Math.max(q1, q2, q3, q4)));
    }
  }

  let result: Interval = BOTTOM;
  for (const partRes of partResults) {
    result = join(result, partRes);
  }

  return { result, mayDivZero, mustDivZero };
}

// ---------------------------------------------------------------------------
// 32-Bit Integer Helpers
// ---------------------------------------------------------------------------

export function withinInt32(i: Interval): boolean {
  if (i.bottom) return true;
  return i.lo >= INT32_MIN && i.hi <= INT32_MAX;
}

export function outsideInt32(i: Interval): boolean {
  if (i.bottom) return false;
  return i.hi < INT32_MIN || i.lo > INT32_MAX;
}

export function overlapsInt32(i: Interval): boolean {
  if (i.bottom) return false;
  return !outsideInt32(i);
}

// ---------------------------------------------------------------------------
// Widening and Narrowing
// ---------------------------------------------------------------------------

/**
 * Widening Operator (∇):
 *
 * Theory (Termination Guarantee):
 * The interval lattice has infinite height: a sequence of intervals [0, 0], [0, 1],
 * [0, 2], ... can ascend infinitely without stabilizing. Widening accelerates
 * convergence by extrapolating unstable bounds directly to ±∞ when they expand.
 * Formally, for any sequence x_{n+1} = x_n ∇ F(x_n), each unstable bound can widen
 * at most once (to ±∞), guaranteeing termination in a finite number of steps.
 */
export function widen(oldVal: Interval, newVal: Interval): Interval {
  if (oldVal.bottom) return newVal;
  if (newVal.bottom) return oldVal;

  const lo = newVal.lo < oldVal.lo ? -Infinity : oldVal.lo;
  const hi = newVal.hi > oldVal.hi ? Infinity : oldVal.hi;
  return range(lo, hi);
}

/**
 * Widening with Thresholds:
 * Instead of jumping directly to ±∞, bounds jump to the nearest threshold constant
 * harvested from the program text (e.g. loop conditions, array bounds).
 * This preserves finite height while dramatically improving analysis precision.
 */
export function widenWithThresholds(
  oldVal: Interval,
  newVal: Interval,
  thresholds: number[]
): Interval {
  if (oldVal.bottom) return newVal;
  if (newVal.bottom) return oldVal;

  const uniqueSorted = Array.from(new Set(thresholds)).sort((a, b) => a - b);

  let lo = oldVal.lo;
  if (newVal.lo < oldVal.lo) {
    // Jump to the largest threshold <= newVal.lo, or -Infinity if none exists
    const candidates = uniqueSorted.filter((t) => t <= newVal.lo);
    lo = candidates.length > 0 ? candidates[candidates.length - 1] : -Infinity;
  }

  let hi = oldVal.hi;
  if (newVal.hi > oldVal.hi) {
    // Jump to the smallest threshold >= newVal.hi, or +Infinity if none exists
    const candidate = uniqueSorted.find((t) => t >= newVal.hi);
    hi = candidate !== undefined ? candidate : Infinity;
  }

  return range(lo, hi);
}

/**
 * Narrowing Operator (Δ):
 *
 * Theory (Precision Recovery):
 * While widening guarantees termination, jumping to ±∞ often introduces over-approximation.
 * Narrowing refines the post-fixpoint by recovering finite bounds from transfer functions
 * without compromising soundness. Narrowing only replaces infinite bounds with finite ones,
 * preventing infinite descending chains.
 */
export function narrow(oldVal: Interval, newVal: Interval): Interval {
  if (oldVal.bottom) return oldVal;
  if (newVal.bottom) return newVal;

  const lo = oldVal.lo === -Infinity ? newVal.lo : oldVal.lo;
  const hi = oldVal.hi === Infinity ? newVal.hi : oldVal.hi;
  return range(lo, hi);
}

// ---------------------------------------------------------------------------
// Backward-Refinement Helpers
// ---------------------------------------------------------------------------

export function refineLt(x: Interval, e: Interval): Interval {
  if (x.bottom || e.bottom) return BOTTOM;
  const upper = e.hi === Infinity ? Infinity : e.hi - 1;
  return meet(x, range(-Infinity, upper));
}

export function refineLe(x: Interval, e: Interval): Interval {
  if (x.bottom || e.bottom) return BOTTOM;
  return meet(x, range(-Infinity, e.hi));
}

export function refineGt(x: Interval, e: Interval): Interval {
  if (x.bottom || e.bottom) return BOTTOM;
  const lower = e.lo === -Infinity ? -Infinity : e.lo + 1;
  return meet(x, range(lower, Infinity));
}

export function refineGe(x: Interval, e: Interval): Interval {
  if (x.bottom || e.bottom) return BOTTOM;
  return meet(x, range(e.lo, Infinity));
}

export function refineEq(x: Interval, e: Interval): Interval {
  if (x.bottom || e.bottom) return BOTTOM;
  return meet(x, e);
}

export function refineNe(x: Interval, e: Interval): Interval {
  if (x.bottom || e.bottom) return BOTTOM;
  if (isSingleton(e)) {
    const c = e.lo;
    if (x.lo === c && x.hi === c) {
      return BOTTOM;
    }
    if (x.lo === c) {
      return range(c + 1, x.hi);
    }
    if (x.hi === c) {
      return range(x.lo, c - 1);
    }
  }
  return x;
}

/**
 * Format interval as human-readable string.
 */
export function intervalToString(i: Interval): string {
  if (i.bottom) return '⊥';
  const loStr = i.lo === -Infinity ? '-∞' : i.lo.toString();
  const hiStr = i.hi === Infinity ? '+∞' : i.hi.toString();
  return `[${loStr}, ${hiStr}]`;
}
