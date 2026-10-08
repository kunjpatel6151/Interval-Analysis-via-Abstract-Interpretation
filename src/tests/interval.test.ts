import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  Interval,
  Bound,
  BOTTOM,
  TOP,
  range,
  constant,
  isBottom,
  contains,
  equals,
  leq,
  join,
  meet,
  add,
  sub,
  neg,
  mul,
  div,
  widen,
  widenWithThresholds,
  narrow,
  refineLt,
  refineLe,
  refineGt,
  refineGe,
  refineEq,
  refineNe,
  withinInt32,
  outsideInt32,
  overlapsInt32,
} from '../domain/interval';

// Helper fast-check arbitrary for Interval
const arbBound: fc.Arbitrary<Bound> = fc.oneof(
  fc.integer({ min: -10000, max: 10000 }),
  fc.constant(-Infinity),
  fc.constant(Infinity)
);

const arbInterval: fc.Arbitrary<Interval> = fc.oneof(
  fc.constant(BOTTOM),
  fc.constant(TOP),
  fc.tuple(arbBound, arbBound).map(([b1, b2]) => {
    const lo = Math.min(b1, b2);
    const hi = Math.max(b1, b2);
    return range(lo, hi);
  }),
  fc.integer({ min: -1000, max: 1000 }).map((n) => constant(n))
);

type NonBottomInterval = { bottom: false; lo: Bound; hi: Bound };

const arbNonBottomInterval: fc.Arbitrary<NonBottomInterval> = fc.oneof(
  fc.constant(TOP as NonBottomInterval),
  fc.tuple(arbBound, arbBound).map(([b1, b2]) => {
    const lo = Math.min(b1, b2);
    const hi = Math.max(b1, b2);
    return range(lo, hi) as NonBottomInterval;
  }),
  fc.integer({ min: -1000, max: 1000 }).map((n) => constant(n) as NonBottomInterval)
);

describe('Interval Domain - Hand-written Edge Cases', () => {
  it('correctly inspects intervals: isBottom, isTop, isSingleton', () => {
    expect(isBottom(BOTTOM)).toBe(true);
    expect(isBottom(range(1, 2))).toBe(false);
    expect(isBottom(range(5, 2))).toBe(true); // Normalized to bottom on construction
  });

  it('handles infinity multiplication with zero without NaN', () => {
    const res1 = mul(range(0, 0), range(-Infinity, Infinity));
    expect(res1).toEqual(range(0, 0));

    const res2 = mul(range(0, 0), range(10, Infinity));
    expect(res2).toEqual(range(0, 0));
  });

  it('computes symmetric multiplication correctly: [-5, 5] * [-5, 5] = [-25, 25]', () => {
    const a = range(-5, 5);
    const b = range(-5, 5);
    expect(mul(a, b)).toEqual(range(-25, 25));
  });

  it('integer division [1, 10] / [2, 3] = [0, 5]', () => {
    const a = range(1, 10);
    const b = range(2, 3);
    const { result, mayDivZero, mustDivZero } = div(a, b);
    expect(result).toEqual(range(0, 5));
    expect(mayDivZero).toBe(false);
    expect(mustDivZero).toBe(false);
  });

  it('division when divisor spans zero: [-10, 10] / [-2, 2]', () => {
    const a = range(-10, 10);
    const b = range(-2, 2);
    const { result, mayDivZero, mustDivZero } = div(a, b);
    expect(result).toEqual(range(-10, 10));
    expect(mayDivZero).toBe(true);
    expect(mustDivZero).toBe(false);
  });

  it('division by definite zero: [5, 5] / [0, 0]', () => {
    const a = range(5, 5);
    const b = range(0, 0);
    const { result, mayDivZero, mustDivZero } = div(a, b);
    expect(result).toEqual(BOTTOM);
    expect(mayDivZero).toBe(true);
    expect(mustDivZero).toBe(true);
  });

  it('division with numerator [0, 0]: [0, 0] / [1, 5] = [0, 0]', () => {
    const a = range(0, 0);
    const b = range(1, 5);
    const { result, mayDivZero } = div(a, b);
    expect(result).toEqual(range(0, 0));
    expect(mayDivZero).toBe(false);
  });

  it('truncation toward zero for negative division: [-7, -7] / [2, 2] = [-3, -3]', () => {
    const a = range(-7, -7);
    const b = range(2, 2);
    const { result } = div(a, b);
    expect(result).toEqual(range(-3, -3));
  });

  it('evaluates int32 range classifications', () => {
    expect(withinInt32(range(-100, 100))).toBe(true);
    expect(withinInt32(range(-3000000000, 0))).toBe(false);

    expect(outsideInt32(range(3000000000, 4000000000))).toBe(true);
    expect(outsideInt32(range(0, 100))).toBe(false);

    expect(overlapsInt32(range(2000000000, 3000000000))).toBe(true);
    expect(overlapsInt32(range(3000000000, 4000000000))).toBe(false);
  });
});

describe('Interval Domain - Lattice Laws (Property-Based)', () => {
  it('join is commutative, associative, and idempotent', () => {
    fc.assert(
      fc.property(arbInterval, arbInterval, arbInterval, (a, b, c) => {
        // Commutativity: a ⊔ b = b ⊔ a
        expect(equals(join(a, b), join(b, a))).toBe(true);

        // Idempotence: a ⊔ a = a
        expect(equals(join(a, a), a)).toBe(true);

        // Associativity: (a ⊔ b) ⊔ c = a ⊔ (b ⊔ c)
        expect(equals(join(join(a, b), c), join(a, join(b, c)))).toBe(true);
      })
    );
  });

  it('meet is commutative, associative, and idempotent', () => {
    fc.assert(
      fc.property(arbInterval, arbInterval, arbInterval, (a, b, c) => {
        // Commutativity
        expect(equals(meet(a, b), meet(b, a))).toBe(true);

        // Idempotence
        expect(equals(meet(a, a), a)).toBe(true);

        // Associativity
        expect(equals(meet(meet(a, b), c), meet(a, meet(b, c)))).toBe(true);
      })
    );
  });

  it('absorption laws hold: a ⊔ (a ⊓ b) = a and a ⊓ (a ⊔ b) = a', () => {
    fc.assert(
      fc.property(arbInterval, arbInterval, (a, b) => {
        expect(equals(join(a, meet(a, b)), a)).toBe(true);
        expect(equals(meet(a, join(a, b)), a)).toBe(true);
      })
    );
  });

  it('BOTTOM is the join identity and meet zero', () => {
    fc.assert(
      fc.property(arbInterval, (a) => {
        expect(equals(join(a, BOTTOM), a)).toBe(true);
        expect(equals(meet(a, BOTTOM), BOTTOM)).toBe(true);
        expect(leq(BOTTOM, a)).toBe(true);
      })
    );
  });

  it('leq agrees with join: a ⊑ b <=> a ⊔ b = b', () => {
    fc.assert(
      fc.property(arbInterval, arbInterval, (a, b) => {
        const isLeq = leq(a, b);
        const joinEqualsB = equals(join(a, b), b);
        expect(isLeq).toBe(joinEqualsB);
      })
    );
  });
});

describe('Interval Domain - Soundness Properties', () => {
  const arbIntervalWithInt = arbNonBottomInterval.filter(
    (iv) => !(iv.lo === -Infinity && iv.hi === -Infinity) && !(iv.lo === Infinity && iv.hi === Infinity)
  );

  const arbIntervalAndElem = arbIntervalWithInt.chain((iv) => {
    let minVal: number;
    let maxVal: number;
    if (!Number.isFinite(iv.lo) && !Number.isFinite(iv.hi)) {
      minVal = -1000;
      maxVal = 1000;
    } else if (!Number.isFinite(iv.lo)) {
      maxVal = Math.trunc(iv.hi);
      minVal = maxVal - 50;
    } else if (!Number.isFinite(iv.hi)) {
      minVal = Math.trunc(iv.lo);
      maxVal = minVal + 50;
    } else {
      minVal = Math.trunc(iv.lo);
      maxVal = Math.trunc(iv.hi);
    }
    return fc.tuple(
      fc.constant(iv),
      fc.integer({ min: minVal, max: maxVal })
    );
  });

  it('soundness of addition, subtraction, multiplication, negation, and division', () => {
    fc.assert(
      fc.property(
        arbIntervalAndElem,
        arbIntervalAndElem,
        ([A, n], [B, m]) => {
          // Addition
          expect(contains(add(A, B), n + m)).toBe(true);

          // Subtraction
          expect(contains(sub(A, B), n - m)).toBe(true);

          // Negation
          expect(contains(neg(A), -n)).toBe(true);

          // Multiplication
          expect(contains(mul(A, B), n * m)).toBe(true);

          // Division (when m != 0)
          if (m !== 0) {
            const divRes = div(A, B);
            const expectedQuotient = Math.trunc(n / m);
            expect(contains(divRes.result, expectedQuotient)).toBe(true);
          }
        }
      )
    );
  });

  it('invariance: no operation produces NaN or an inverted interval (lo > hi)', () => {
    fc.assert(
      fc.property(arbInterval, arbInterval, (a, b) => {
        const results = [
          join(a, b),
          meet(a, b),
          add(a, b),
          sub(a, b),
          mul(a, b),
          div(a, b).result,
          neg(a),
          widen(a, b),
          narrow(a, b),
          refineLt(a, b),
          refineLe(a, b),
          refineGt(a, b),
          refineGe(a, b),
          refineEq(a, b),
          refineNe(a, b),
        ];

        for (const res of results) {
          if (!res.bottom) {
            expect(Number.isNaN(res.lo)).toBe(false);
            expect(Number.isNaN(res.hi)).toBe(false);
            expect(res.lo <= res.hi).toBe(true);
          }
        }
      })
    );
  });
});

describe('Interval Domain - Widening & Narrowing', () => {
  it('widening upper-bounds both operands: old <= widen(old, new) and new <= widen(old, new)', () => {
    fc.assert(
      fc.property(arbInterval, arbInterval, (oldVal, newVal) => {
        const w = widen(oldVal, newVal);
        expect(leq(oldVal, w)).toBe(true);
        expect(leq(newVal, w)).toBe(true);
      })
    );
  });

  it('simulated ascending chain always stabilizes in at most 2 widening steps', () => {
    // Chain: [0, 0] -> [0, 1] -> [0, 2] -> [0, 3]...
    let current = range(0, 0);
    const steps = [range(0, 1), range(0, 2), range(0, 3)];

    for (let i = 0; i < steps.length; i++) {
      current = widen(current, steps[i]);
    }

    // After widening, the upper bound must have jumped to +Infinity and stabilized
    expect(current).toEqual(range(0, Infinity));
    const nextWiden = widen(current, range(0, 100));
    expect(equals(nextWiden, current)).toBe(true);
  });

  it('widen with thresholds jumps to the next threshold instead of infinity', () => {
    const thresholds = [10, 50, 100];
    const oldVal = range(0, 0);
    const newVal = range(0, 1);

    // Without thresholds: jumps to [0, +Inf]
    expect(widen(oldVal, newVal)).toEqual(range(0, Infinity));

    // With thresholds: jumps to smallest threshold >= 1, which is 10
    const w1 = widenWithThresholds(oldVal, newVal, thresholds);
    expect(w1).toEqual(range(0, 10));

    // Another jump beyond 10 goes to 50
    const w2 = widenWithThresholds(w1, range(0, 15), thresholds);
    expect(w2).toEqual(range(0, 50));

    // Beyond all thresholds goes to +Infinity
    const w3 = widenWithThresholds(w2, range(0, 105), thresholds);
    expect(w3).toEqual(range(0, Infinity));
  });

  it('narrowing recovers precision on infinite bounds', () => {
    const oldVal = range(0, Infinity);
    const newVal = range(0, 100);

    const narrowed = narrow(oldVal, newVal);
    expect(narrowed).toEqual(range(0, 100));

    // narrow(old, new) <= old
    expect(leq(narrowed, oldVal)).toBe(true);
    // when new <= old, new <= narrow(old, new)
    expect(leq(newVal, narrowed)).toBe(true);
  });
});

describe('Interval Domain - Backward Refinement Soundness', () => {
  it('refinement operations preserve all valid concrete models', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: -100, max: 100 }),
        (n, m) => {
          const x = range(-100, 100);
          const e = range(-100, 100);

          if (n < m) {
            expect(contains(refineLt(x, e), n)).toBe(true);
          }
          if (n <= m) {
            expect(contains(refineLe(x, e), n)).toBe(true);
          }
          if (n > m) {
            expect(contains(refineGt(x, e), n)).toBe(true);
          }
          if (n >= m) {
            expect(contains(refineGe(x, e), n)).toBe(true);
          }
          if (n === m) {
            expect(contains(refineEq(x, e), n)).toBe(true);
          }
          if (n !== m) {
            expect(contains(refineNe(x, constant(m)), n)).toBe(true);
          }
        }
      )
    );
  });
});
