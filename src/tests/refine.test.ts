import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { Lexer } from '../core/lexer';
import { Parser } from '../core/parser';
import { Cond } from '../core/ast';
import { AbstractState } from '../domain/state';
import { range, constant, contains } from '../domain/interval';
import { refine, negate } from '../analysis/refine';
import { analyze, unreachableLines } from '../analysis/analyze';
import { Observer } from '../analysis/eval';

function parseCond(code: string): Cond {
  const fullCode = `if (${code}) {}`;
  const ast = new Parser(new Lexer(fullCode).tokenize()).parse();
  return (ast.stmts[0] as any).cond;
}

describe('Branch Refinement - Phase 5', () => {
  it('refines all six comparisons with variable on left and constant on right', () => {
    const s = AbstractState.empty().set('x', range(0, 10));

    expect(refine(parseCond('x < 5'), s).get('x')).toEqual(range(0, 4));
    expect(refine(parseCond('x <= 5'), s).get('x')).toEqual(range(0, 5));
    expect(refine(parseCond('x > 5'), s).get('x')).toEqual(range(6, 10));
    expect(refine(parseCond('x >= 5'), s).get('x')).toEqual(range(5, 10));
    expect(refine(parseCond('x == 5'), s).get('x')).toEqual(range(5, 5));
    // != in interior does not shrink bounds
    expect(refine(parseCond('x != 5'), s).get('x')).toEqual(range(0, 10));
  });

  it('refines mirrored comparisons: 5 > x behaves like x < 5', () => {
    const s = AbstractState.empty().set('x', range(0, 10));
    expect(refine(parseCond('5 > x'), s).get('x')).toEqual(range(0, 4));
    expect(refine(parseCond('5 <= x'), s).get('x')).toEqual(range(5, 10));
  });

  it('refines both sides when both are variables: x < y', () => {
    const s = AbstractState.empty()
      .set('x', range(0, 10))
      .set('y', range(3, 4));

    const refined = refine(parseCond('x < y'), s);
    expect(refined.get('x')).toEqual(range(0, 3));
    expect(refined.get('y')).toEqual(range(3, 4));
  });

  it('pushes negation inward via De Morgan laws', () => {
    const s = AbstractState.empty().set('x', range(0, 10));

    // Negation of x < 5 is x >= 5
    const falseBranch = refine(parseCond('x < 5'), s, true);
    expect(falseBranch.get('x')).toEqual(range(5, 10));

    // De Morgan: !(x < 5 && y > 2) => x >= 5 || y <= 2
    const c = parseCond('x < 5 && y > 2');
    const negated = negate(c);
    expect(negated.kind).toBe('LogicalCond');
    if (negated.kind === 'LogicalCond') {
      expect(negated.op).toBe('||');
    }
  });

  it('sequential refinement for &&: x > 2 && x < 8', () => {
    const s = AbstractState.empty().set('x', range(0, 10));
    const refined = refine(parseCond('x > 2 && x < 8'), s);
    expect(refined.get('x')).toEqual(range(3, 7));
  });

  it('disjunctive join for ||: x < 2 || x > 8 gives [0, 10] due to interval convexity', () => {
    const s = AbstractState.empty().set('x', range(0, 10));
    // [0, 1] ⊔ [9, 10] = [0, 10]
    const refined = refine(parseCond('x < 2 || x > 8'), s);
    expect(refined.get('x')).toEqual(range(0, 10));
  });

  it('refines != at bounds and collapses to UNREACHABLE on singletons', () => {
    const s = AbstractState.empty().set('x', range(0, 10));
    expect(refine(parseCond('x != 0'), s).get('x')).toEqual(range(1, 10));
    expect(refine(parseCond('x != 10'), s).get('x')).toEqual(range(0, 9));

    const sSingleton = AbstractState.empty().set('x', constant(5));
    const refined = refine(parseCond('x != 5'), sSingleton);
    expect(refined.isUnreachable()).toBe(true);
  });

  it('detects dead code when branch is infeasible', () => {
    const code = `
      int x = 5;
      if (x > 10) {
        x = 1;
      }
    `;
    const res = analyze(code);
    expect(res.errors).toHaveLength(0);

    const dead = unreachableLines(res);
    // Line 4 (x = 1;) is unreachable dead code
    expect(dead).toContain(4);
  });

  it('the main example: first division possible zero, second division proven safe', () => {
    const code = `
      int x = input(0, 10);
      int y = 10 - x;
      int z = 100 / y;
      if (y > 0) {
        z = 100 / y;
      }
    `;

    const divisions: { line: number; divisor: any }[] = [];
    const obs: Observer = {
      onDiv: (line, divisor) => {
        divisions.push({ line, divisor });
      },
    };

    const res = analyze(code, {}, obs);
    expect(res.errors).toHaveLength(0);

    // Div 1 at line 4: y in [0, 10] (contains 0)
    const div1 = divisions.find((d) => d.line === 4);
    expect(div1).toBeDefined();
    expect(div1!.divisor).toEqual(range(0, 10));

    // Div 2 at line 6: inside if (y > 0), y refined to [1, 10] (safe, does not contain 0)
    const div2 = divisions.find((d) => d.line === 6);
    expect(div2).toBeDefined();
    expect(div2!.divisor).toEqual(range(1, 10));
  });

  it('refines state after assert(x > 0)', () => {
    const code = `
      int x = input(-5, 5);
      assert(x > 0);
    `;
    const res = analyze(code);
    expect(res.errors).toHaveLength(0);

    const exitState = res.solve!.states.get(res.cfg!.exit)!;
    expect(exitState.get('x')).toEqual(range(1, 5));
  });

  it('performs backward linear arithmetic refinement: x + 1 < 5', () => {
    const s = AbstractState.empty().set('x', range(0, 10));
    const refined = refine(parseCond('x + 1 < 5'), s);
    expect(refined.get('x')).toEqual(range(0, 3));
  });

  it('property-based soundness of branch refinement across random models (1000+ tests)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: -50, max: 50 }),
        fc.constantFrom('<', '<=', '>', '>=', '==', '!='),
        (n, m, op) => {
          const s = AbstractState.empty()
            .set('x', range(-50, 50))
            .set('y', range(-50, 50));

          const condStr = `x ${op} y`;
          const cond = parseCond(condStr);

          // Evaluate concrete comparison
          let holds = false;
          switch (op) {
            case '<':
              holds = n < m;
              break;
            case '<=':
              holds = n <= m;
              break;
            case '>':
              holds = n > m;
              break;
            case '>=':
              holds = n >= m;
              break;
            case '==':
              holds = n === m;
              break;
            case '!=':
              holds = n !== m;
              break;
          }

          if (holds) {
            const refined = refine(cond, s, false);
            expect(refined.isUnreachable()).toBe(false);
            expect(contains(refined.get('x'), n)).toBe(true);
            expect(contains(refined.get('y'), m)).toBe(true);
          }
        }
      ),
      { numRuns: 1000 }
    );
  });
});
