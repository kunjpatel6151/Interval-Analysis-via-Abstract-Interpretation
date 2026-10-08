import { describe, it, expect } from 'vitest';
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import {
  VarDeclStmt,
  IfStmt,
  WhileStmt,
  BinaryExpr,
} from '../ast';

describe('Parser', () => {
  it('parses variable declarations and expressions with correct precedence', () => {
    const code = 'int x = 10 + 2 * 3;';
    const lexer = new Lexer(code);
    const parser = new Parser(lexer.tokenize());
    const ast = parser.parse();

    expect(ast.stmts).toHaveLength(1);
    const stmt = ast.stmts[0] as VarDeclStmt;
    expect(stmt.kind).toBe('VarDecl');
    expect(stmt.name).toBe('x');

    const init = stmt.init as BinaryExpr;
    expect(init.kind).toBe('Binary');
    expect(init.op).toBe('+');
    expect((init.left as any).value).toBe(10);

    const right = init.right as BinaryExpr;
    expect(right.kind).toBe('Binary');
    expect(right.op).toBe('*');
    expect((right.left as any).value).toBe(2);
    expect((right.right as any).value).toBe(3);
  });

  it('parses input(lo, hi) expression including negative numbers', () => {
    const code = 'int x = input(-5, 10);';
    const lexer = new Lexer(code);
    const parser = new Parser(lexer.tokenize());
    const ast = parser.parse();

    const stmt = ast.stmts[0] as VarDeclStmt;
    expect(stmt.init).toEqual({
      kind: 'Input',
      min: -5,
      max: 10,
      loc: { line: 1, col: 9 },
    });
  });

  it('parses array declaration and array indexing', () => {
    const code = 'int arr[5]; arr[1] = arr[0] + 1;';
    const lexer = new Lexer(code);
    const parser = new Parser(lexer.tokenize());
    const ast = parser.parse();

    expect(ast.stmts).toHaveLength(2);
    expect(ast.stmts[0].kind).toBe('ArrayDecl');
    expect(ast.stmts[1].kind).toBe('ArrayStore');
  });

  it('parses while loops and if/else constructs', () => {
    const code = `
      int i = 0;
      while (i < 100) {
        if (i == 50) {
          assert(i != 0);
        } else {
          i = i + 1;
        }
      }
    `;
    const lexer = new Lexer(code);
    const parser = new Parser(lexer.tokenize());
    const ast = parser.parse();

    expect(ast.stmts).toHaveLength(2);
    const whileStmt = ast.stmts[1] as WhileStmt;
    expect(whileStmt.kind).toBe('While');
    expect(whileStmt.body.stmts[0].kind).toBe('If');
    const ifStmt = whileStmt.body.stmts[0] as IfStmt;
    expect(ifStmt.thenBlock.stmts[0].kind).toBe('Assert');
    expect(ifStmt.elseBlock?.stmts[0].kind).toBe('Assign');
  });
});
