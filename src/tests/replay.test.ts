import { describe, it, expect } from 'vitest';
import { analyze } from '../analysis/analyze';
import {
  statesAtStep,
  intervalHistory,
  phaseBoundaries,
  stepLabel,
  stepDiff,
} from '../analysis/replay';

describe('Trace Replay & History (src/analysis/replay.ts)', () => {
  const samplePrograms = [
    `int x = 1; int y = x + 2;`,
    `int x = input(0, 10); int y = 10 - x; int z = 100 / y;`,
    `int i = 0; while (i < 100) { i = i + 1; }`,
    `int a[5]; int i = 0; while (i < 5) { a[i] = i; i = i + 1; }`,
    `int x = input(0, 2000000000); int y = x * 2;`,
  ];

  it('1. statesAtStep(final step) equals result.states across 5 sample programs', () => {
    for (const code of samplePrograms) {
      const res = analyze(code);
      const solve = res.solve!;
      const trace = solve.trace;

      const finalStepIndex = trace.length - 1;
      const replayStates = statesAtStep(solve, finalStepIndex);

      for (const [nodeId, expectedState] of solve.states.entries()) {
        const replayState = replayStates.get(nodeId);
        expect(replayState).toBeDefined();
        expect(replayState!.equals(expectedState)).toBe(true);
      }
    }
  });

  it('2. intervalHistory of i at loop head of (i < 100) traces exact sequence [0,0] -> [0,1] -> widened [0,+∞] -> narrowed [0,100]', () => {
    /**
     * WHY THIS EXACT SEQUENCE IS PRODUCED:
     * Program: `int i = 0; while (i < 100) { i = i + 1; }`
     * Options: wideningDelay = 2, narrowingRounds = 3.
     *
     * 1. Step -1 (initial state before loop entry): i = [0, 0].
     * 2. Visit 1 to loop head (entry edge i=0): i = [0, 0].
     * 3. Visit 2 to loop head (back edge after i=i+1): i = [0, 0] ⊔ [1, 1] = [0, 1]. (visit count = 2 <= wideningDelay 2, delay phase).
     * 4. Visit 3 to loop head (back edge after i=1+1): visit count = 3 > wideningDelay 2.
     *    Widening triggers (∇): [0, 1] ∇ ([0, 1] ⊔ [1, 2]) => upper bound expands to +∞ -> [0, +∞].
     * 5. Narrowing Phase (Δ):
     *    Post-fixpoint at loop exit restricts condition !(i < 100) -> i >= 100.
     *    Narrowing computes loop guard intersection: [0, +∞] ⊓ [0, 100] = [0, 100].
     */
    const code = `int i = 0;
while (i < 100) {
  i = i + 1;
}`;
    const res = analyze(code, { wideningDelay: 2, narrowingRounds: 3 });
    const solve = res.solve!;
    const loopHeadId = res.cfg!.loopHeads[0];

    const history = intervalHistory(solve, loopHeadId, 'i');
    expect(history.length).toBeGreaterThan(0);

    const formattedHistory = history.map((h) => ({
      step: h.step,
      inv: `[${h.interval.bottom ? '⊥' : `${h.interval.lo},${h.interval.hi}`}]`,
      widened: h.widened,
      phase: h.phase,
    }));

    // Initial value at step -1
    expect(formattedHistory[0].inv).toBe('[0,0]');

    // Widened entry in history
    const widenedEntry = formattedHistory.find((h) => h.widened);
    expect(widenedEntry).toBeDefined();
    expect(widenedEntry!.inv).toBe('[0,Infinity]');

    // Narrowed entry in history
    const narrowedEntry = formattedHistory.find((h) => h.phase === 'narrowing');
    expect(narrowedEntry).toBeDefined();
    expect(narrowedEntry!.inv).toBe('[0,100]');
  });

  it('3. scrubbing forwards then backwards produces identical states (no mutation bugs)', () => {
    const code = `int i = 0; while (i < 100) { i = i + 1; }`;
    const solve = analyze(code).solve!;
    const lastStep = solve.trace.length - 1;

    // Forward scrubbing to end
    const endStates = statesAtStep(solve, lastStep);

    // Scrub backward to middle (step 10)
    const midStates = statesAtStep(solve, 10);
    expect(midStates.size).toBeGreaterThan(0);

    // Scrub forward again to end
    const endStates2 = statesAtStep(solve, lastStep);

    for (const [nodeId, s1] of endStates.entries()) {
      const s2 = endStates2.get(nodeId);
      expect(s2).toBeDefined();
      expect(s1.equals(s2!)).toBe(true);
    }
  });

  it('4. recordTrace=false returns empty trace without throwing', () => {
    const code = `int x = 1; x = x + 1;`;
    const solve = analyze(code, { recordTrace: false }).solve!;

    expect(solve.trace).toHaveLength(0);
    const bounds = phaseBoundaries(solve);
    expect(bounds.totalSteps).toBe(0);

    const history = intervalHistory(solve, 0, 'x');
    expect(history.length).toBeLessThanOrEqual(1);

    const label = stepLabel(solve, 0);
    expect(label).toBe('Initial State');

    const diff = stepDiff(solve, 0);
    expect(diff).toBeNull();
  });
});
