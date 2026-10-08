import { describe, it, expect } from 'vitest';
import { AbstractState } from '../domain/state';
import { range, constant, BOTTOM, TOP } from '../domain/interval';
import { IntervalDomain } from '../domain/domain';

describe('AbstractState', () => {
  it('enforces immutability on state updates', () => {
    const s1 = AbstractState.empty().set('x', range(0, 10));
    const s2 = s1.set('x', range(0, 20));

    expect(s1.get('x')).toEqual(range(0, 10));
    expect(s2.get('x')).toEqual(range(0, 20));
  });

  it('normalizes the whole state to UNREACHABLE if any variable becomes BOTTOM', () => {
    const s = AbstractState.empty().set('x', range(0, 10));
    expect(s.isUnreachable()).toBe(false);

    const sBottom = s.set('y', BOTTOM);
    expect(sBottom.isUnreachable()).toBe(true);
    expect(sBottom.get('x')).toEqual(BOTTOM);
    expect(sBottom.get('y')).toEqual(BOTTOM);
  });

  it('treats missing variables soundly as TOP', () => {
    const s = AbstractState.empty().set('x', range(5, 5));
    expect(s.get('unseen')).toEqual(TOP);
  });

  it('computes pointwise join correctly across shared and disjoint variables', () => {
    const s1 = AbstractState.empty()
      .set('x', range(0, 5))
      .set('y', range(10, 20));
    const s2 = AbstractState.empty()
      .set('x', range(3, 10))
      .set('y', range(15, 25));

    const joined = s1.join(s2);
    expect(joined.get('x')).toEqual(range(0, 10));
    expect(joined.get('y')).toEqual(range(10, 25));

    // Join with unreachable is the identity
    expect(s1.join(AbstractState.UNREACHABLE).equals(s1)).toBe(true);
    expect(AbstractState.UNREACHABLE.join(s1).equals(s1)).toBe(true);
  });

  it('computes pointwise meet and collapses to UNREACHABLE on disjoint intervals', () => {
    const s1 = AbstractState.empty().set('x', range(0, 10));
    const s2 = AbstractState.empty().set('x', range(5, 15));
    const meetRes = s1.meet(s2);

    expect(meetRes.get('x')).toEqual(range(5, 10));

    const sDisjoint = AbstractState.empty().set('x', range(20, 30));
    const emptyMeet = s1.meet(sDisjoint);
    expect(emptyMeet.isUnreachable()).toBe(true);
  });

  it('computes pointwise widening and narrowing', () => {
    const s1 = AbstractState.empty().set('i', range(0, 0));
    const s2 = AbstractState.empty().set('i', range(0, 1));

    const widened = s1.widen(s2);
    expect(widened.get('i')).toEqual(range(0, Infinity));

    const narrowed = widened.narrow(AbstractState.empty().set('i', range(0, 100)));
    expect(narrowed.get('i')).toEqual(range(0, 100));
  });

  it('formats state toString nicely with Unicode symbols', () => {
    const s = AbstractState.empty()
      .set('x', range(0, 10))
      .set('y', range(-Infinity, 5));

    expect(s.toString()).toBe('x∈[0, 10] y∈[-∞, 5]');
    expect(AbstractState.UNREACHABLE.toString()).toBe('⊥');
    expect(AbstractState.empty().toString()).toBe('⊤');
  });

  it('verifies that IntervalDomain implements the generic Domain interface', () => {
    expect(IntervalDomain.bottom).toEqual(BOTTOM);
    expect(IntervalDomain.top).toEqual(TOP);
    expect(IntervalDomain.fromConst(5)).toEqual(constant(5));
    expect(IntervalDomain.add(constant(2), constant(3))).toEqual(constant(5));
    expect(IntervalDomain.toString(range(0, Infinity))).toBe('[0, +∞]');
  });
});
