import { describe, it, expect } from 'vitest';
import { Lexer } from '../lexer';

describe('Lexer', () => {
  it('tokenizes keywords, identifiers, and numbers', () => {
    const code = 'int x = input(0, 10);';
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();

    expect(tokens.map((t) => t.type)).toEqual([
      'KW_INT',
      'ID',
      'ASSIGN',
      'KW_INPUT',
      'LPAREN',
      'INT',
      'COMMA',
      'INT',
      'RPAREN',
      'SEMI',
      'EOF',
    ]);
    expect(tokens[1].value).toBe('x');
    expect(tokens[5].value).toBe('0');
    expect(tokens[7].value).toBe('10');
  });

  it('tracks line and column numbers accurately', () => {
    const code = 'int a;\nint b = 5;';
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();

    expect(tokens[0]).toMatchObject({ type: 'KW_INT', line: 1, col: 1 });
    expect(tokens[3]).toMatchObject({ type: 'KW_INT', line: 2, col: 1 });
    expect(tokens[4]).toMatchObject({ type: 'ID', value: 'b', line: 2, col: 5 });
  });

  it('tokenizes array syntax and operations', () => {
    const code = 'int arr[5]; arr[0] = 10 + 2 * 3;';
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();

    expect(tokens.map((t) => t.type)).toEqual([
      'KW_INT',
      'ID',
      'LBRACK',
      'INT',
      'RBRACK',
      'SEMI',
      'ID',
      'LBRACK',
      'INT',
      'RBRACK',
      'ASSIGN',
      'INT',
      'PLUS',
      'INT',
      'STAR',
      'INT',
      'SEMI',
      'EOF',
    ]);
  });

  it('handles logical operators and comparison operators', () => {
    const code = 'if (x <= 10 && y != 0 || !flag)';
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();

    expect(tokens.map((t) => t.type)).toEqual([
      'KW_IF',
      'LPAREN',
      'ID',
      'LTE',
      'INT',
      'AND',
      'ID',
      'NEQ',
      'INT',
      'OR',
      'NOT',
      'ID',
      'RPAREN',
      'EOF',
    ]);
  });
});
