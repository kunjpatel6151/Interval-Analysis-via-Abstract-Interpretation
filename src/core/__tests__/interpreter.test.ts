import { describe, it, expect } from 'vitest';
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { ConcreteInterpreter, RuntimeError } from '../interpreter';

describe('ConcreteInterpreter', () => {
  it('evaluates basic arithmetic and variable updates', () => {
    const code = `
      int x = 5;
      int y = 10 - x;
      int z = y * 4;
    `;
    const ast = new Parser(new Lexer(code).tokenize()).parse();
    const interpreter = new ConcreteInterpreter();
    const result = interpreter.run(ast);

    expect(result.vars).toEqual({ x: 5, y: 5, z: 20 });
  });

  it('executes input provider deterministically', () => {
    const code = `
      int x = input(0, 10);
      int y = 10 - x;
    `;
    const ast = new Parser(new Lexer(code).tokenize()).parse();
    const interpreter = new ConcreteInterpreter({
      inputProvider: (_min, _max) => 4,
    });
    const result = interpreter.run(ast);

    expect(result.vars).toEqual({ x: 4, y: 6 });
  });

  it('executes while loop correctly', () => {
    const code = `
      int i = 0;
      while (i < 5) {
        i = i + 1;
      }
    `;
    const ast = new Parser(new Lexer(code).tokenize()).parse();
    const interpreter = new ConcreteInterpreter();
    const result = interpreter.run(ast);

    expect(result.vars.i).toBe(5);
  });

  it('throws runtime error on division by zero', () => {
    const code = `
      int x = 0;
      int y = 10 / x;
    `;
    const ast = new Parser(new Lexer(code).tokenize()).parse();
    const interpreter = new ConcreteInterpreter();

    expect(() => interpreter.run(ast)).toThrow(RuntimeError);
  });

  it('throws runtime error on array out of bounds', () => {
    const code = `
      int arr[3];
      arr[5] = 10;
    `;
    const ast = new Parser(new Lexer(code).tokenize()).parse();
    const interpreter = new ConcreteInterpreter();

    expect(() => interpreter.run(ast)).toThrow(RuntimeError);
  });
});
