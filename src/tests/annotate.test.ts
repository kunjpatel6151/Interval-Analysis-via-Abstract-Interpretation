import { describe, it, expect } from 'vitest';
import { analyze } from '../analysis/analyze';
import { lineAnnotations } from '../analysis/annotate';

describe('lineAnnotations pure helper', () => {
  it('annotates straight-line program variables and changes', () => {
    const code = `int x = 1;
int y = x + 2;`;
    const res = analyze(code);
    const map = lineAnnotations(res);

    expect(map.has(1)).toBe(true);
    expect(map.has(2)).toBe(true);

    const l1 = map.get(1)!;
    expect(l1.vars).toEqual([{ name: 'x', interval: '[1, 1]', changed: true }]);

    const l2 = map.get(2)!;
    expect(l2.vars.find((v) => v.name === 'y')).toEqual({
      name: 'y',
      interval: '[3, 3]',
      changed: true,
    });
  });

  it('annotates main division example with guarded and unguarded intervals', () => {
    const code = `int x = input(0, 10);
int y = 10 - x;
int z = 100 / y;
if (y > 0) {
  z = 100 / y;
}`;
    const res = analyze(code);
    const map = lineAnnotations(res);

    // Line 2: y ∈ [0, 10]
    const l2 = map.get(2)!;
    const yL2 = l2.vars.find((v) => v.name === 'y');
    expect(yL2).toBeDefined();
    expect(yL2!.interval).toBe('[0, 10]');

    // Line 4: if (y > 0) branch node sees y ∈ [0, 10]
    const l4 = map.get(4)!;
    const yL4 = l4.vars.find((v) => v.name === 'y');
    expect(yL4).toBeDefined();
    expect(yL4!.interval).toBe('[0, 10]');

    // Line 5 inside if: z = 100 / y sees y ∈ [1, 10]
    const l5 = map.get(5)!;
    const yL5 = l5.vars.find((v) => v.name === 'y');
    expect(yL5).toBeDefined();
    expect(yL5!.interval).toBe('[1, 10]');
  });

  it('marks statements inside a dead branch as reachable=false', () => {
    const code = `int x = 5;
if (x > 10) {
  x = 1;
}`;
    const res = analyze(code);
    const map = lineAnnotations(res);

    const l3 = map.get(3)!;
    expect(l3).toBeDefined();
    expect(l3.reachable).toBe(false);
  });

  it('loop head shows [0, 100] after narrowing', () => {
    const code = `int i = 0;
while (i < 100) {
  i = i + 1;
}`;
    const res = analyze(code);
    const map = lineAnnotations(res);

    const l2 = map.get(2)!; // while (i < 100)
    expect(l2).toBeDefined();
    const iL2 = l2.vars.find((v) => v.name === 'i');
    expect(iL2).toBeDefined();
    expect(iL2!.interval).toBe('[0, 100]');
  });

  it('blank lines and lines with no edges are absent from the map', () => {
    const code = `int x = 1;

x = x + 1;`;
    const res = analyze(code);
    const map = lineAnnotations(res);

    expect(map.has(1)).toBe(true);
    expect(map.has(2)).toBe(false); // blank line
    expect(map.has(3)).toBe(true);
  });
});
