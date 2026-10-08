import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { analyze, AnalysisResult } from '../analysis/analyze';
import { checkPostFixpoint } from '../analysis/fixpoint';
import { AbstractState } from '../domain/state';
import { range, constant, contains } from '../domain/interval';
import { ConcreteInterpreter } from '../core/interpreter';

function stateAtHead(res: AnalysisResult, index = 0): AbstractState {
  const headId = res.cfg!.loopHeads[index];
  return res.solve!.states.get(headId)!;
}

function stateAtExit(res: AnalysisResult): AbstractState {
  return res.solve!.states.get(res.cfg!.exit)!;
}

describe('Widening, Narrowing, and Thresholds - Phase 6', () => {
  const headlineLoop = `
    int i = 0;
    while (i < 100) {
      i = i + 1;
    }
  `;

  it('headline loop: widening on, narrowing off gives [0, +Inf] at head and [100, +Inf] at exit', () => {
    const res = analyze(headlineLoop, { widening: true, narrowing: false });
    expect(res.errors).toHaveLength(0);
    expect(res.solve?.terminated).toBe(true);
    expect(res.solve?.iterations).toBeLessThan(20);

    const headState = stateAtHead(res);
    const exitState = stateAtExit(res);

    expect(headState.get('i')).toEqual(range(0, Infinity));
    expect(exitState.get('i')).toEqual(range(100, Infinity));
  });

  it('headline loop: widening + narrowing recovers [0, 100] at head and [100, 100] at exit', () => {
    const res = analyze(headlineLoop, { widening: true, narrowing: true });
    expect(res.errors).toHaveLength(0);
    expect(res.solve?.terminated).toBe(true);
    expect(res.solve?.iterations).toBeLessThan(20);

    const headState = stateAtHead(res);
    const exitState = stateAtExit(res);

    expect(headState.get('i')).toEqual(range(0, 100));
    expect(exitState.get('i')).toEqual(constant(100));
  });

  it('regression: widening OFF hits the iteration cap with terminated=false', () => {
    const res = analyze(headlineLoop, { widening: false, maxIterations: 50 });
    expect(res.errors).toHaveLength(0);
    expect(res.solve?.terminated).toBe(false);
  });

  it('thresholds: reaches [0, 100] directly during ascending phase without narrowing', () => {
    const res = analyze(headlineLoop, {
      widening: true,
      narrowing: false,
      thresholds: true,
    });
    expect(res.errors).toHaveLength(0);
    expect(res.solve?.terminated).toBe(true);

    const headState = stateAtHead(res);
    const exitState = stateAtExit(res);

    expect(headState.get('i')).toEqual(range(0, 100));
    expect(exitState.get('i')).toEqual(constant(100));
  });

  it('delay parameter: wideningDelay 0 vs 2 both terminate soundly, and delay postpones widening', () => {
    const resDelay0 = analyze(headlineLoop, { widening: true, narrowing: false, wideningDelay: 0 });
    const resDelay2 = analyze(headlineLoop, { widening: true, narrowing: false, wideningDelay: 2 });

    expect(resDelay0.solve?.terminated).toBe(true);
    expect(resDelay2.solve?.terminated).toBe(true);

    // With delay 0, widening fires on the first cycle
    const firstWiden0 = resDelay0.solve!.trace.findIndex((s) => s.widened);
    const firstWiden2 = resDelay2.solve!.trace.findIndex((s) => s.widened);

    expect(firstWiden0).toBeGreaterThanOrEqual(0);
    expect(firstWiden2).toBeGreaterThan(firstWiden0);
  });

  it('down-counting loop: head in [0, 100] and exit at [0, 0]', () => {
    const code = `
      int i = 100;
      while (i > 0) {
        i = i - 1;
      }
    `;
    const res = analyze(code, { widening: true, narrowing: true });
    expect(res.errors).toHaveLength(0);
    expect(res.solve?.terminated).toBe(true);

    const headState = stateAtHead(res);
    const exitState = stateAtExit(res);

    expect(headState.get('i')).toEqual(range(0, 100));
    expect(exitState.get('i')).toEqual(constant(0));
  });

  it('unbounded loop with input: head in [0, 50], exit in [1, 50]', () => {
    // Relational Domain Note:
    // With intervals alone, the relational dependency i <= n is lost because intervals
    // track variable dimensions independently. When exiting via !(i < n) => i >= n,
    // interval intersection between i in [0, 50] and n in [1, 50] gives i in [1, 50].
    // Proving i == n requires relational domains such as Octagons or Difference Bounds.
    const code = `
      int n = input(1, 50);
      int i = 0;
      while (i < n) {
        i = i + 1;
      }
    `;
    const res = analyze(code, { widening: true, narrowing: true });
    expect(res.errors).toHaveLength(0);
    expect(res.solve?.terminated).toBe(true);

    const headState = stateAtHead(res);
    const exitState = stateAtExit(res);

    expect(headState.get('i')).toEqual(range(0, 50));
    expect(exitState.get('i')).toEqual(range(1, 50));
  });

  it('nested loops: both heads widen and narrow with inner counter reset', () => {
    const code = `
      int i = 0;
      while (i < 10) {
        int j = 0;
        while (j < 5) {
          j = j + 1;
        }
        i = i + 1;
      }
    `;
    const res = analyze(code, { widening: true, narrowing: true });
    expect(res.errors).toHaveLength(0);
    expect(res.solve?.terminated).toBe(true);

    const exitState = stateAtExit(res);
    // Narrowing recovers i = [10, 10] at exit (precise!)
    expect(exitState.get('i')).toEqual(constant(10));
    // j is TOP at exit because it's declared inside the outer loop body;
    // on the first entry to the outer loop head, j hasn't been declared yet
    // (missing → TOP), and the exit guard flows from the head state.
    // Recovering j = 5 would require per-iteration tracking beyond intervals.

    // Verify inner loop head state: j is precisely [0, 5], i is [0, 9]
    const innerHeadState = stateAtHead(res, 1);  // second loop head (inner)
    expect(innerHeadState.get('j')).toEqual(range(0, 5));
    expect(innerHeadState.get('i')).toEqual(range(0, 9));
  });

  it('two variables moving simultaneously: x incrementing and y decrementing', () => {
    // Relational Domain Note:
    // Proving y == 0 at exit requires knowing x + y == 10 (a relational invariant).
    // Interval analysis tracks variables independently, so it cannot capture this
    // correlation. The best interval analysis can do is y ∈ [-∞, 10].
    const code = `
      int x = 0;
      int y = 10;
      while (x < 10) {
        x = x + 1;
        y = y - 1;
      }
    `;
    const res = analyze(code, { widening: true, narrowing: true });
    expect(res.errors).toHaveLength(0);
    expect(res.solve?.terminated).toBe(true);

    const exitState = stateAtExit(res);
    // x is precisely narrowed to [10, 10]
    expect(exitState.get('x')).toEqual(constant(10));
    // y's lower bound is -∞ because narrowing can't recover it without
    // relational information; the upper bound is 10 from initialization.
    expect(contains(exitState.get('y'), 0)).toBe(true);  // soundness: y=0 is included
    expect(exitState.get('y').bottom).toBe(false);
  });

  it('narrowing never increases state: S_narrow <= S_widen, and post-fixpoint holds', () => {
    const programs = [
      `int i = 0; while (i < 50) { i = i + 1; }`,
      `int i = 20; while (i > 0) { i = i - 1; }`,
      `int a = 0; int b = 100; while (a < 10) { a = a + 1; b = b - 2; }`,
      `int x = input(0, 5); while (x < 20) { x = x + 2; }`,
      `int i = 0; int sum = 0; while (i < 5) { sum = sum + i; i = i + 1; }`,
      `int x = 10; while (x > 0) { if (x > 5) { x = x - 1; } else { x = x - 2; } }`,
      `int i = 0; while (i < 15) { int j = 0; while (j < 3) { j = j + 1; } i = i + 1; }`,
      `int x = 0; while (x < 100) { x = x + 5; }`,
    ];

    for (const code of programs) {
      const resWidenOnly = analyze(code, { widening: true, narrowing: false });
      const resNarrowed = analyze(code, { widening: true, narrowing: true });

      expect(resNarrowed.solve?.terminated).toBe(true);

      // Verify checkPostFixpoint passes
      expect(checkPostFixpoint(resNarrowed.cfg!, resNarrowed.solve!.states)).toBe(true);

      // Assert S_narrow <= S_widen at every node
      for (const node of resNarrowed.cfg!.nodes) {
        const sWiden = resWidenOnly.solve!.states.get(node.id)!;
        const sNarrow = resNarrowed.solve!.states.get(node.id)!;
        expect(sNarrow.leq(sWiden)).toBe(true);
      }
    }
  });

  it('narrowing precision limit: loop stepping by 2 over < 100 leaves interval [0, +Inf] without threshold', () => {
    // Known imprecision note:
    // In `while (x != 100) x = x + 2`, the loop condition != 100 only excludes 100
    // when entering the false branch. Inside the loop, x is unconstrained by != 100,
    // so narrowing cannot recover a finite upper bound without thresholds or relational domain.
    const code = `
      int x = 0;
      while (x != 100) {
        x = x + 2;
      }
    `;
    const res = analyze(code, { widening: true, narrowing: true, thresholds: false });
    expect(res.solve?.terminated).toBe(true);

    const headState = stateAtHead(res);
    const xIv = headState.get('x');
    expect(!xIv.bottom && xIv.hi === Infinity).toBe(true);
  });

  it('trace recording integrity: widened flags set, narrowing phase tagged, and deterministic', () => {
    const res1 = analyze(headlineLoop, { widening: true, narrowing: true });
    const res2 = analyze(headlineLoop, { widening: true, narrowing: true });

    expect(res1.solve!.trace.length).toBe(res2.solve!.trace.length);

    const hasWidenedStep = res1.solve!.trace.some((s) => s.widened);
    const hasNarrowingStep = res1.solve!.trace.some((s) => s.phase === 'narrowing');

    expect(hasWidenedStep).toBe(true);
    expect(hasNarrowingStep).toBe(true);

    for (let i = 0; i < res1.solve!.trace.length; i++) {
      expect(res1.solve!.trace[i].node).toBe(res2.solve!.trace[i].node);
      expect(res1.solve!.trace[i].phase).toBe(res2.solve!.trace[i].phase);
      expect(res1.solve!.trace[i].widened).toBe(res2.solve!.trace[i].widened);
    }
  });

  it('property-based termination: random loop programs always terminate with widening on', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5, max: 10 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 15, max: 50 }),
        (start, step, bound) => {
          const code = `
            int x = ${start};
            while (x < ${bound}) {
              x = x + ${step};
            }
          `;
          const res = analyze(code, { widening: true, maxIterations: 100 });
          expect(res.errors).toHaveLength(0);
          expect(res.solve?.terminated).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('soundness over looping programs under all analysis configurations (concrete fuzzing)', () => {
    const loopCodes = [
      `int i = 0; while (i < 10) { i = i + 1; }`,
      `int n = input(1, 5); int i = 0; while (i < n) { i = i + 1; }`,
      `int x = 10; while (x > 0) { x = x - 2; }`,
      `int a = input(0, 3); int b = 5; while (a < 5) { a = a + 1; b = b + 2; }`,
    ];

    const configs = [
      { widening: true, narrowing: false },
      { widening: true, narrowing: true },
      { widening: true, narrowing: false, thresholds: true },
      { widening: true, narrowing: true, thresholds: true },
      { widening: true, narrowing: true, unrollLoops: 1 },
      { widening: true, narrowing: true, unrollLoops: 2 },
    ];

    for (const code of loopCodes) {
      for (const config of configs) {
        const res = analyze(code, config);
        expect(res.errors).toHaveLength(0);
        expect(res.solve?.terminated).toBe(true);

        const exitState = stateAtExit(res);
        const interpreter = new ConcreteInterpreter();

        for (let run = 0; run < 100; run++) {
          const concreteResult = interpreter.run(res.ast!);
          for (const [vName, vVal] of Object.entries(concreteResult.vars)) {
            const iv = exitState.get(vName);
            expect(contains(iv, vVal)).toBe(true);
          }
        }
      }
    }
  });
});
