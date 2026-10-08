import { describe, it, expect } from 'vitest';
import { analyze, AnalysisResult } from '../analysis/analyze';
import { Observer } from '../analysis/eval';
import { AbstractState } from '../domain/state';
import { range, constant, Interval, contains, equals } from '../domain/interval';
import { ConcreteInterpreter } from '../core/interpreter';

function stateAtExit(res: AnalysisResult): AbstractState {
  if (!res.cfg || !res.solve) {
    throw new Error('Analysis did not produce a valid CFG or solve result');
  }
  return res.solve.states.get(res.cfg.exit)!;
}

describe('Abstract Interpretation Analysis - Phase 4', () => {
  it('analyzes straight-line programs to exact constants at exit', () => {
    const code = `
      int x = 5;
      int y = x * 2 + 1;
    `;
    const res = analyze(code);
    expect(res.errors).toHaveLength(0);

    const exitState = stateAtExit(res);
    expect(exitState.get('x')).toEqual(constant(5));
    expect(exitState.get('y')).toEqual(constant(11));
  });

  it('tracks input interval ranges and arithmetic subtraction', () => {
    const code = `
      int x = input(0, 10);
      int y = 10 - x;
    `;
    const res = analyze(code);
    expect(res.errors).toHaveLength(0);

    const exitState = stateAtExit(res);
    expect(exitState.get('x')).toEqual(range(0, 10));
    expect(exitState.get('y')).toEqual(range(0, 10));
  });

  it('computes sound join at confluence node after if/else', () => {
    const code = `
      int x = input(0, 10);
      int y;
      if (x < 5) {
        y = 1;
      } else {
        y = 2;
      }
    `;
    const res = analyze(code);
    expect(res.errors).toHaveLength(0);

    const exitState = stateAtExit(res);
    expect(exitState.get('y')).toEqual(range(1, 2));

    // Refinement ensures then-branch has y=[1, 1] and else-branch has y=[2, 2]
    const allStates = Array.from(res.solve!.states.values());
    const thenBranchState = allStates.find((s) => equals(s.get('y'), constant(1)));
    const elseBranchState = allStates.find((s) => equals(s.get('y'), constant(2)));
    expect(thenBranchState).toBeDefined();
    expect(elseBranchState).toBeDefined();
    expect(thenBranchState!.get('x')).toEqual(range(0, 4));
    expect(elseBranchState!.get('x')).toEqual(range(5, 10));
  });

  it('evaluates division with divisor containing zero and notifies observer', () => {
    const code = `
      int x = input(0, 10);
      int y = 10 - x;
      int z = 100 / y;
    `;

    let observedDivisor: Interval | undefined;
    let observedLine: number | undefined;

    const obs: Observer = {
      onDiv: (line, divisor) => {
        observedLine = line;
        observedDivisor = divisor;
      },
    };

    const res = analyze(code, {}, obs);
    expect(res.errors).toHaveLength(0);

    const exitState = stateAtExit(res);
    // y in [0, 10], divisor splits to [1, 10], 100 / [1, 10] = [10, 100]
    expect(exitState.get('z')).toEqual(range(10, 100));

    expect(observedLine).toBe(4);
    expect(observedDivisor).toEqual(range(0, 10));
    expect(contains(observedDivisor!, 0)).toBe(true);
  });

  it('collapses to UNREACHABLE state after definite division by zero', () => {
    const code = `
      int x = 0;
      int y = 5 / x;
      int z = 10;
    `;
    const res = analyze(code);
    expect(res.errors).toHaveLength(0);

    const exitState = stateAtExit(res);
    expect(exitState.isUnreachable()).toBe(true);
  });

  it('fires observer hooks for division, array indices, and arithmetic', () => {
    const code = `
      int arr[5];
      int i = 2;
      int a = arr[i];
      int b = -a;
      int c = b + 10;
      int d = c / 2;
    `;

    const arithOps: string[] = [];
    let indexChecked: Interval | undefined;
    let divNotified = false;

    const obs: Observer = {
      onIndex: (_line, _name, idx) => {
        indexChecked = idx;
      },
      onArith: (_line, op) => {
        arithOps.push(op);
      },
      onDiv: () => {
        divNotified = true;
      },
    };

    const res = analyze(code, {}, obs);
    expect(res.errors).toHaveLength(0);

    expect(indexChecked).toEqual(constant(2));
    expect(arithOps).toContain('-');
    expect(arithOps).toContain('+');
    expect(divNotified).toBe(true);
  });

  it('unwidened unbounded loop hits iteration cap and reports terminated=false', () => {
    const code = `
      int i = 0;
      while (i < 100) {
        i = i + 1;
      }
    `;
    // Without widening, i increments infinitely in abstract interpretation (needs widening)
    const res = analyze(code, { widening: false, maxIterations: 50 });
    expect(res.errors).toHaveLength(0);
    expect(res.solve?.terminated).toBe(false);
  });

  it('converges on loop that naturally stabilizes without widening', () => {
    // A loop with small bound stabilizes naturally without widening:
    const code = `
      int x = 0;
      while (x < 3) {
        x = x + 1;
      }
    `;
    const res = analyze(code);
    expect(res.errors).toHaveLength(0);
    expect(res.solve?.terminated).toBe(true);
    const exitState = stateAtExit(res);
    expect(exitState.get('x')).toEqual(constant(3));

    // An infinite loop stabilizes at loop head, but its exit is correctly proven unreachable:
    const codeInf = `
      int x = 1;
      while (x < 5) {
        x = 1;
      }
    `;
    const resInf = analyze(codeInf);
    expect(resInf.solve?.terminated).toBe(true);
    expect(stateAtExit(resInf).isUnreachable()).toBe(true);
  });

  it('guarantees deterministic execution across repeated solve runs', () => {
    const code = `
      int a = input(0, 10);
      int b = 20;
      if (a < 5) {
        b = a + 1;
      } else {
        b = a - 1;
      }
    `;
    const res1 = analyze(code);
    const res2 = analyze(code);

    expect(res1.solve?.trace.length).toBe(res2.solve?.trace.length);
    for (let i = 0; i < (res1.solve?.trace.length ?? 0); i++) {
      const step1 = res1.solve!.trace[i];
      const step2 = res2.solve!.trace[i];
      expect(step1.node).toBe(step2.node);
      expect(step1.edgeId).toBe(step2.edgeId);
      expect(step1.newState.equals(step2.newState)).toBe(true);
    }
  });

  it('validates trace step integrity and state reconstruction', () => {
    const code = `
      int x = input(0, 10);
      int y = 10 - x;
      int z = 100 / y;
    `;
    const res = analyze(code);
    const trace = res.solve!.trace;

    expect(trace.length).toBeGreaterThan(0);

    const reconstructed = new Map<number, AbstractState>();
    for (let i = 0; i < trace.length; i++) {
      const step = trace[i];
      expect(step.iteration).toBe(i + 1);
      expect(step.oldState.equals(step.newState)).toBe(false);
      reconstructed.set(step.node, step.newState);
    }

    // Node states at exit match final reconstructed trace state
    expect(reconstructed.get(res.cfg!.exit)?.equals(stateAtExit(res))).toBe(true);
  });

  it('soundness smoke test: concrete execution values lie within abstract intervals', () => {
    const testPrograms = [
      `int x = 5; int y = x * 3; int z = y - 2;`,
      `int a = input(0, 10); int b = 10 - a; int c = a + b;`,
      `int x = input(1, 20); int y = input(2, 5); int z = x / y;`,
      `int a = input(0, 5); int b = 0; if (a < 3) { b = 10; } else { b = 20; }`,
      `int x = input(-10, 10); int y = -x; int z = y * 2;`,
      `int x = input(1, 10); int y = input(1, 10); int z = (x + y) * (x - y);`,
      `int a = input(0, 10); int b = a + 5; int c = 100 / (b + 1);`,
    ];

    for (const code of testPrograms) {
      const res = analyze(code);
      expect(res.errors).toHaveLength(0);
      const exitState = stateAtExit(res);

      const interpreter = new ConcreteInterpreter();

      // Run 500 randomized concrete runs
      for (let run = 0; run < 500; run++) {
        const concreteResult = interpreter.run(res.ast!);
        for (const [varName, concreteVal] of Object.entries(concreteResult.vars)) {
          const abstractInterval = exitState.get(varName);
          expect(contains(abstractInterval, concreteVal)).toBe(true);
        }
      }
    }
  });

  it('returns parse and syntax errors cleanly without throwing exceptions', () => {
    const invalidCode = `int x = ;`;
    const res = analyze(invalidCode);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors[0]).toContain('Parser Error');
    expect(res.ast).toBeUndefined();
    expect(res.solve).toBeUndefined();
  });
});
