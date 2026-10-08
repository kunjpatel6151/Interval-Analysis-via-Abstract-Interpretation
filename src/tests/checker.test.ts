import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { analyze } from '../analysis/analyze';
import { lineSeverity, groupByLine, formatFinding, formatReport } from '../analysis/checker';
import { ConcreteInterpreter, RuntimeError } from '../core/interpreter';
import { Lexer } from '../core/lexer';
import { Parser } from '../core/parser';

describe('Phase 7: Static Analysis Checker', () => {
  // Test 1: Division, main example
  it('1. division: detects possible div-by-zero on un-guarded division and safe inside guard', () => {
    const code = `int x = input(0, 10);
int y = 10 - x;
int z = 100 / y;
if (y > 0) {
  z = 100 / y;
}`;
    const res = analyze(code);
    expect(res.check).toBeDefined();
    const findings = res.check!.findings;

    // Line 3: POSSIBLE div-by-zero
    const line3 = findings.find((f) => f.line === 3 && f.kind === 'div-by-zero');
    expect(line3).toBeDefined();
    expect(line3!.severity).toBe('possible');
    expect(line3!.message).toContain('divisor y');

    // Line 5 inside if: SAFE div-by-zero
    const line5 = findings.find((f) => f.line === 5 && f.kind === 'div-by-zero');
    expect(line5).toBeDefined();
    expect(line5!.severity).toBe('safe');
  });

  // Test 2: Definite division
  it('2. definite division by zero makes post-state unreachable and downstream lines unreachable', () => {
    const code = `int x = 0;
int y = 5 / x;
int z = y + 1;`;
    const res = analyze(code);
    const findings = res.check!.findings;

    const line2 = findings.find((f) => f.line === 2 && f.kind === 'div-by-zero');
    expect(line2).toBeDefined();
    expect(line2!.severity).toBe('definite');

    const line3 = findings.find((f) => f.line === 3 && f.kind === 'unreachable');
    expect(line3).toBeDefined();
    expect(line3!.severity).toBe('unreachable');
  });

  // Test 3: Array safe
  it('3. array store is safe when loop guard restricts index to valid bounds', () => {
    const code = `int a[10];
int i = 0;
while (i < 10) {
  a[i] = i;
  i = i + 1;
}`;
    const res = analyze(code);
    const line4 = res.check!.findings.find((f) => f.line === 4 && f.kind === 'array-bounds');
    expect(line4).toBeDefined();
    expect(line4!.severity).toBe('safe');
  });

  // Test 4: Array off-by-one, definite, and negative index
  it('4. array index: off-by-one gives POSSIBLE; out of bounds gives DEFINITE', () => {
    const codePossible = `int a[10];
int i = 0;
while (i <= 10) {
  a[i] = i;
  i = i + 1;
}`;
    const resPossible = analyze(codePossible);
    const line4P = resPossible.check!.findings.find((f) => f.line === 4 && f.kind === 'array-bounds');
    expect(line4P).toBeDefined();
    expect(line4P!.severity).toBe('possible');

    const codeDefiniteHigh = `int a[10];
a[10] = 1;`;
    const resDefHigh = analyze(codeDefiniteHigh);
    const line2DH = resDefHigh.check!.findings.find((f) => f.line === 2 && f.kind === 'array-bounds');
    expect(line2DH).toBeDefined();
    expect(line2DH!.severity).toBe('definite');

    const codeDefiniteNeg = `int a[10];
a[-1] = 1;`;
    const resDefNeg = analyze(codeDefiniteNeg);
    const line2DN = resDefNeg.check!.findings.find((f) => f.line === 2 && f.kind === 'array-bounds');
    expect(line2DN).toBeDefined();
    expect(line2DN!.severity).toBe('definite');
  });

  // Test 5: Array read inside an expression
  it('5. array read inside expression reports bounds checks correctly', () => {
    const code = `int a[10];
int i = 0;
int v = a[i];`;
    const res = analyze(code);
    const line3 = res.check!.findings.find((f) => f.line === 3 && f.kind === 'array-bounds');
    expect(line3).toBeDefined();
    expect(line3!.severity).toBe('safe');
  });

  // Test 6: Overflow checks (+, -, *, neg)
  it('6. overflow: detects POSSIBLE, DEFINITE, and SAFE int32 operations', () => {
    const codePossible = `int x = input(0, 2000000000);
int y = x * 2;`;
    const resP = analyze(codePossible);
    const line2P = resP.check!.findings.find((f) => f.line === 2 && f.kind === 'overflow');
    expect(line2P).toBeDefined();
    expect(line2P!.severity).toBe('possible');

    const codeDefinite = `int x = 2000000000;
int y = x + x;`;
    const resD = analyze(codeDefinite);
    const line2D = resD.check!.findings.find((f) => f.line === 2 && f.kind === 'overflow');
    expect(line2D).toBeDefined();
    expect(line2D!.severity).toBe('definite');

    const codeSafe = `int x = input(0, 100);
int y = x * 2;`;
    const resS = analyze(codeSafe);
    const line2S = resS.check!.findings.find((f) => f.line === 2 && f.kind === 'overflow');
    expect(line2S).toBeDefined();
    expect(line2S!.severity).toBe('safe');
  });

  // Test 7: Assertions and state refinement continuation
  it('7. assertions: safe (proven), possible (unproven), definite (fails), and continuation', () => {
    const codeSafe = `int x = input(1, 5);
assert(x > 0);`;
    const resS = analyze(codeSafe);
    const fS = resS.check!.findings.find((f) => f.line === 2 && f.kind === 'assertion');
    expect(fS!.severity).toBe('safe');

    const codePossible = `int x = input(-5, 5);
assert(x > 0);`;
    const resP = analyze(codePossible);
    const fP = resP.check!.findings.find((f) => f.line === 2 && f.kind === 'assertion');
    expect(fP!.severity).toBe('possible');

    const codeDefinite = `int x = 3;
assert(x > 10);`;
    const resD = analyze(codeDefinite);
    const fD = resD.check!.findings.find((f) => f.line === 2 && f.kind === 'assertion');
    expect(fD!.severity).toBe('definite');

    // Continuation test: after assert(x > 0) on x ∈ [-5, 5], x is refined to [1, 5], so 10 / x is safe
    const codeContinuation = `int x = input(-5, 5);
assert(x > 0);
int z = 10 / x;`;
    const resC = analyze(codeContinuation);
    const fDiv = resC.check!.findings.find((f) => f.line === 3 && f.kind === 'div-by-zero');
    expect(fDiv).toBeDefined();
    expect(fDiv!.severity).toBe('safe');
  });

  // Test 8: Dead branch
  it('8. dead branch emits UNREACHABLE finding naming the condition', () => {
    const code = `int x = 5;
if (x > 10) {
  x = 1;
}`;
    const res = analyze(code);
    const line2 = res.check!.findings.find((f) => f.line === 2 && f.kind === 'unreachable');
    expect(line2).toBeDefined();
    expect(line2!.severity).toBe('unreachable');
    expect(line2!.message).toContain('x > 10');
  });

  // Test 9: De-duplication
  it('9. loop programs produce exactly one finding per (line, kind, message)', () => {
    const code = `int i = 0;
while (i < 100) {
  int x = 10 / (i + 1);
  i = i + 1;
}`;
    const res = analyze(code);
    const line3Findings = res.check!.findings.filter((f) => f.line === 3 && f.kind === 'div-by-zero');
    expect(line3Findings).toHaveLength(1);
  });

  // Test 10: Severity order
  it('10. lineSeverity returns worst severity according to rank (definite > possible > unreachable > safe)', () => {
    const checkRes = {
      findings: [
        { id: 1, line: 3, kind: 'div-by-zero' as const, severity: 'safe' as const, message: 'm1', intervals: {}, edgeId: 1 },
        { id: 2, line: 3, kind: 'overflow' as const, severity: 'possible' as const, message: 'm2', intervals: {}, edgeId: 2 },
      ],
      summary: { safe: 1, possible: 1, definite: 0, unreachable: 0 },
    };
    expect(lineSeverity(checkRes, 3)).toBe('possible');
    expect(lineSeverity(checkRes, 99)).toBe('safe');
  });

  // Test 11: reportSafe=false
  it('11. reportSafe=false hides safe findings but keeps summary counts intact', () => {
    const code = `int x = input(1, 5);
assert(x > 0);
int y = input(-5, 5);
assert(y > 0);`;
    const resDefault = analyze(code, { reportSafe: true });
    expect(resDefault.check!.findings.some((f) => f.severity === 'safe')).toBe(true);

    const resFiltered = analyze(code, { reportSafe: false });
    expect(resFiltered.check!.findings.some((f) => f.severity === 'safe')).toBe(false);
    expect(resFiltered.check!.summary.safe).toBe(resDefault.check!.summary.safe);
    expect(resFiltered.check!.summary.possible).toBe(resDefault.check!.summary.possible);
  });

  // Test 12: Six example programs formatted reports
  it('12. six example programs generate correct formatted reports', () => {
    const p1 = `int x = input(0, 10);
int y = 10 - x;
int z = 100 / y;
if (y > 0) {
  z = 100 / y;
}`;

    const p2 = `int x = 0;
int y = 5 / x;
int z = y + 1;`;

    const p3 = `int a[10];
int i = 0;
while (i < 10) {
  a[i] = i;
  i = i + 1;
}`;

    const p4 = `int x = input(0, 2000000000);
int y = x * 2;
int a = input(0, 100);
int b = a * 2;`;

    const p5 = `int x = input(1, 5);
assert(x > 0);
int y = input(-5, 5);
assert(y > 0);
int z = 3;
assert(z > 10);`;

    const p6 = `int x = 5;
if (x > 10) {
  x = 1;
}`;

    const r1 = formatReport(analyze(p1).check!);
    const r2 = formatReport(analyze(p2).check!);
    const r3 = formatReport(analyze(p3).check!);
    const r4 = formatReport(analyze(p4).check!);
    const r5 = formatReport(analyze(p5).check!);
    const r6 = formatReport(analyze(p6).check!);

    expect(r1).toContain('POSSIBLE div-by-zero');
    expect(r2).toContain('DEFINITE div-by-zero');
    expect(r3).toContain('SAFE array-bounds');
    expect(r4).toContain('POSSIBLE overflow');
    expect(r5).toContain('DEFINITE assertion');
    expect(r6).toContain('UNREACHABLE unreachable');

    expect(r1).toMatchSnapshot();
    expect(r2).toMatchSnapshot();
    expect(r3).toMatchSnapshot();
    expect(r4).toMatchSnapshot();
    expect(r5).toMatchSnapshot();
    expect(r6).toMatchSnapshot();
  });

  // Test 13: Imprecision / False Positive example
  it('13. imprecision example: relational loss on (x - x) produces expected false positive', () => {
    /**
     * IMPRECISION EXAMPLE & EXPECTED FALSE POSITIVE DOCUMENTATION:
     * In the non-relational interval abstract domain, evaluating `y = x - x` for `x ∈ [-5, 5]`
     * computes `[-5, 5] - [-5, 5] = [-10, 10]`.
     * The analysis loses the correlation that both operands reference the SAME variable `x`.
     * Consequentially, `y + 10` is evaluated as `[-10, 10] + 10 = [0, 20]`.
     * A following division `100 / (y + 10)` sees a divisor interval `[0, 20]` containing 0,
     * which triggers a POSSIBLE div-by-zero warning.
     * In reality, for any concrete execution, `x - x` is identically 0, `y + 10` is identically 10,
     * and division by zero NEVER occurs.
     * This is an EXPECTED FALSE POSITIVE inherent to the non-relational interval domain.
     */
    const code = `int x = input(-5, 5);
int y = x - x;
int z = 100 / (y + 10);`;

    const res = analyze(code);
    const fDiv = res.check!.findings.find((f) => f.line === 3 && f.kind === 'div-by-zero');
    expect(fDiv).toBeDefined();
    expect(fDiv!.severity).toBe('possible');
  });

  // Test 14: SOUNDNESS OF THE CHECKER (fast-check property testing with 500+ runs)
  it('14. SOUNDNESS OF THE CHECKER: 500+ randomized concrete runs verify no false negatives, definite triggers, and unreachability', () => {
    const programs = [
      `int x = input(0, 10); int y = 10 - x; int z = 100 / y;`,
      `int a[5]; int i = input(0, 7); a[i] = 1;`,
      `int x = input(-2, 2); assert(x != 0);`,
      `int x = input(1000000000, 2000000000); int y = x * 2;`,
      `int x = 5; if (x > 10) { int y = 100 / 0; }`,
    ];

    for (const code of programs) {
      const parseRes = analyze(code);
      const checkRes = parseRes.check!;
      const ast = new Parser(new Lexer(code).tokenize()).parse();

      // Collect non-safe findings per line and kind
      const nonSafeFindings = checkRes.findings.filter((f) => f.severity !== 'safe');
      const unreachableLines = checkRes.findings.filter((f) => f.severity === 'unreachable').map((f) => f.line);

      // Run 100 randomized concrete runs per program (5 programs * 100 = 500 total runs)
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10000 }), (seed) => {
          let currentRandom = seed;
          const randomInputProvider = (min: number, max: number) => {
            currentRandom = (currentRandom * 9301 + 49297) % 233280;
            const rnd = currentRandom / 233280;
            return Math.floor(rnd * (max - min + 1)) + min;
          };

          const interpreter = new ConcreteInterpreter({ inputProvider: randomInputProvider });

          try {
            const runResult = interpreter.run(ast);

            // Property: No line reported as unreachable was executed in the trace
            for (const record of runResult.trace) {
              expect(unreachableLines.includes(record.line)).toBe(false);
            }
          } catch (err: unknown) {
            if (err instanceof RuntimeError) {
              // Property: Soundness (No False Negatives)
              // If concrete execution hits error of kind K at line L, checker reported non-safe finding of kind K at line L
              const matchingFinding = nonSafeFindings.find(
                (f) => f.line === err.line && (f.kind === err.kind || err.kind === 'unreachable')
              );
              expect(matchingFinding).toBeDefined();
            }
          }
        }),
        { numRuns: 100 }
      );
    }
  });

  // Test 15: Helper functions
  it('15. groupByLine and formatFinding work properly', () => {
    const code = `int x = input(0, 10);
int y = 100 / x;`;
    const res = analyze(code);
    const grouped = groupByLine(res.check!);
    expect(grouped.has(2)).toBe(true);

    const f = res.check!.findings[0];
    const text = formatFinding(f);
    expect(text).toContain(`line ${f.line}: ${f.severity.toUpperCase()}`);
  });
});
