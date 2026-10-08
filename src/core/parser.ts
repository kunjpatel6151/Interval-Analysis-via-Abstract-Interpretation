import { Token, TokenType } from './lexer';
import {
  Program,
  Stmt,
  VarDeclStmt,
  ArrayDeclStmt,
  AssignStmt,
  ArrayStoreStmt,
  IfStmt,
  WhileStmt,
  AssertStmt,
  BlockStmt,
  Expr,
  InputExpr,
  Cond,
  SourceLocation,
  CompareOp,
} from './ast';

export class ParserError extends Error {
  constructor(message: string, public line: number, public col: number) {
    super(`Parser Error [${line}:${col}]: ${message}`);
    this.name = 'ParserError';
  }
}

export class Parser {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  public parse(): Program {
    const stmts: Stmt[] = [];
    while (!this.isAtEnd()) {
      stmts.push(this.parseStmt());
    }
    return { stmts };
  }

  // ---------------------------------------------------------------------------
  // Statement Parsing
  // ---------------------------------------------------------------------------

  private parseStmt(): Stmt {
    const token = this.peek();

    if (token.type === 'KW_INT') {
      return this.parseVarOrArrayDecl();
    }
    if (token.type === 'KW_IF') {
      return this.parseIfStmt();
    }
    if (token.type === 'KW_WHILE') {
      return this.parseWhileStmt();
    }
    if (token.type === 'KW_ASSERT') {
      return this.parseAssertStmt();
    }
    if (token.type === 'LBRACE') {
      return this.parseBlockStmt();
    }
    if (token.type === 'ID') {
      return this.parseAssignOrArrayStore();
    }

    throw new ParserError(
      `Unexpected token '${token.value || token.type}' when parsing statement`,
      token.line,
      token.col
    );
  }

  private parseVarOrArrayDecl(): VarDeclStmt | ArrayDeclStmt {
    const kwToken = this.consume('KW_INT', "Expected 'int'");
    const idToken = this.consume('ID', 'Expected variable or array name');
    const loc: SourceLocation = { line: kwToken.line, col: kwToken.col };

    if (this.match('LBRACK')) {
      // Array declaration: int ID [ INT ];
      const sizeToken = this.consume('INT', 'Expected integer size for array declaration');
      const size = parseInt(sizeToken.value, 10);
      if (isNaN(size) || size <= 0) {
        throw new ParserError(`Array size must be a positive integer, got '${sizeToken.value}'`, sizeToken.line, sizeToken.col);
      }
      this.consume('RBRACK', "Expected ']' after array size");
      this.consume('SEMI', "Expected ';' after array declaration");
      return {
        kind: 'ArrayDecl',
        name: idToken.value,
        size,
        loc,
      };
    }

    // Variable declaration: int ID (= expr)?;
    let init: Expr | undefined;
    if (this.match('ASSIGN')) {
      init = this.parseExpr();
    }
    this.consume('SEMI', "Expected ';' after variable declaration");

    return {
      kind: 'VarDecl',
      name: idToken.value,
      init,
      loc,
    };
  }

  private parseAssignOrArrayStore(): AssignStmt | ArrayStoreStmt {
    const idToken = this.consume('ID', 'Expected identifier');
    const loc: SourceLocation = { line: idToken.line, col: idToken.col };

    if (this.match('LBRACK')) {
      // Array store: ID [ expr ] = expr ;
      const indexExpr = this.parseExpr();
      this.consume('RBRACK', "Expected ']' after array index");
      this.consume('ASSIGN', "Expected '=' in array store");
      const valueExpr = this.parseExpr();
      this.consume('SEMI', "Expected ';' after array store");
      return {
        kind: 'ArrayStore',
        name: idToken.value,
        index: indexExpr,
        value: valueExpr,
        loc,
      };
    }

    // Simple assignment: ID = expr ;
    this.consume('ASSIGN', "Expected '=' in assignment");
    const valueExpr = this.parseExpr();
    this.consume('SEMI', "Expected ';' after assignment");

    return {
      kind: 'Assign',
      name: idToken.value,
      value: valueExpr,
      loc,
    };
  }

  private parseIfStmt(): IfStmt {
    const kwToken = this.consume('KW_IF', "Expected 'if'");
    const loc: SourceLocation = { line: kwToken.line, col: kwToken.col };

    this.consume('LPAREN', "Expected '(' after 'if'");
    const cond = this.parseCond();
    this.consume('RPAREN', "Expected ')' after if condition");

    const thenBlock = this.parseBlockStmt();
    let elseBlock: BlockStmt | undefined;

    if (this.match('KW_ELSE')) {
      if (this.check('KW_IF')) {
        // Handle `else if` as nested block containing single if stmt
        const nestedIf = this.parseIfStmt();
        elseBlock = {
          kind: 'Block',
          stmts: [nestedIf],
          loc: nestedIf.loc,
        };
      } else {
        elseBlock = this.parseBlockStmt();
      }
    }

    return {
      kind: 'If',
      cond,
      thenBlock,
      elseBlock,
      loc,
    };
  }

  private parseWhileStmt(): WhileStmt {
    const kwToken = this.consume('KW_WHILE', "Expected 'while'");
    const loc: SourceLocation = { line: kwToken.line, col: kwToken.col };

    this.consume('LPAREN', "Expected '(' after 'while'");
    const cond = this.parseCond();
    this.consume('RPAREN', "Expected ')' after while condition");

    const body = this.parseBlockStmt();

    return {
      kind: 'While',
      cond,
      body,
      loc,
    };
  }

  private parseAssertStmt(): AssertStmt {
    const kwToken = this.consume('KW_ASSERT', "Expected 'assert'");
    const loc: SourceLocation = { line: kwToken.line, col: kwToken.col };

    this.consume('LPAREN', "Expected '(' after 'assert'");
    const cond = this.parseCond();
    this.consume('RPAREN', "Expected ')' after assert condition");
    this.consume('SEMI', "Expected ';' after assert statement");

    return {
      kind: 'Assert',
      cond,
      loc,
    };
  }

  private parseBlockStmt(): BlockStmt {
    const lbrace = this.consume('LBRACE', "Expected '{'");
    const loc: SourceLocation = { line: lbrace.line, col: lbrace.col };
    const stmts: Stmt[] = [];

    while (!this.check('RBRACE') && !this.isAtEnd()) {
      stmts.push(this.parseStmt());
    }

    this.consume('RBRACE', "Expected '}'");
    return {
      kind: 'Block',
      stmts,
      loc,
    };
  }

  // ---------------------------------------------------------------------------
  // Condition Parsing
  // ---------------------------------------------------------------------------

  private parseCond(): Cond {
    return this.parseOrCond();
  }

  private parseOrCond(): Cond {
    let left = this.parseAndCond();

    while (this.check('OR')) {
      const opToken = this.consume('OR', "Expected '||'");
      const right = this.parseAndCond();
      left = {
        kind: 'LogicalCond',
        op: '||',
        left,
        right,
        loc: { line: opToken.line, col: opToken.col },
      };
    }

    return left;
  }

  private parseAndCond(): Cond {
    let left = this.parseUnaryCond();

    while (this.check('AND')) {
      const opToken = this.consume('AND', "Expected '&&'");
      const right = this.parseUnaryCond();
      left = {
        kind: 'LogicalCond',
        op: '&&',
        left,
        right,
        loc: { line: opToken.line, col: opToken.col },
      };
    }

    return left;
  }

  private parseUnaryCond(): Cond {
    if (this.check('NOT')) {
      const notToken = this.consume('NOT', "Expected '!'");
      const expr = this.parseUnaryCond();
      return {
        kind: 'NotCond',
        expr,
        loc: { line: notToken.line, col: notToken.col },
      };
    }

    // Check for parenthesized condition vs comparison expr
    if (this.check('LPAREN')) {
      // Lookahead to check if this is ( cond ) or ( expr ) comp expr
      // We attempt to parse condition inside parens if it turns out to be a condition
      const savedPos = this.pos;
      try {
        this.consume('LPAREN', '(');
        const innerCond = this.parseCond();
        if (this.check('RPAREN')) {
          this.consume('RPAREN', ')');
          // If followed by an operator, this was actually an expression in parens
          if (this.isCompareOp(this.peek().type)) {
            // Backtrack and parse as compare cond
            this.pos = savedPos;
          } else {
            return innerCond;
          }
        } else {
          this.pos = savedPos;
        }
      } catch {
        this.pos = savedPos;
      }
    }

    return this.parseCompareCond();
  }

  private parseCompareCond(): Cond {
    const left = this.parseExpr();
    const token = this.peek();

    if (this.isCompareOp(token.type)) {
      this.advance();
      const op = token.value as CompareOp;
      const right = this.parseExpr();
      return {
        kind: 'CompareCond',
        op,
        left,
        right,
        loc: { line: token.line, col: token.col },
      };
    }

    throw new ParserError(
      `Expected comparison operator (<, <=, >, >=, ==, !=) but got '${token.value || token.type}'`,
      token.line,
      token.col
    );
  }

  private isCompareOp(type: TokenType): boolean {
    return (
      type === 'LT' ||
      type === 'LTE' ||
      type === 'GT' ||
      type === 'GTE' ||
      type === 'EQ' ||
      type === 'NEQ'
    );
  }

  // ---------------------------------------------------------------------------
  // Expression Parsing (Precedence: + - < * / < unary - < primary)
  // ---------------------------------------------------------------------------

  private parseExpr(): Expr {
    return this.parseAdditiveExpr();
  }

  private parseAdditiveExpr(): Expr {
    let left = this.parseMultiplicativeExpr();

    while (this.check('PLUS') || this.check('MINUS')) {
      const opToken = this.advance();
      const right = this.parseMultiplicativeExpr();
      left = {
        kind: 'Binary',
        op: opToken.value as '+' | '-',
        left,
        right,
        loc: { line: opToken.line, col: opToken.col },
      };
    }

    return left;
  }

  private parseMultiplicativeExpr(): Expr {
    let left = this.parseUnaryExpr();

    while (this.check('STAR') || this.check('SLASH')) {
      const opToken = this.advance();
      const right = this.parseUnaryExpr();
      left = {
        kind: 'Binary',
        op: opToken.value as '*' | '/',
        left,
        right,
        loc: { line: opToken.line, col: opToken.col },
      };
    }

    return left;
  }

  private parseUnaryExpr(): Expr {
    if (this.check('MINUS')) {
      const opToken = this.consume('MINUS', '-');
      const expr = this.parseUnaryExpr();
      return {
        kind: 'Unary',
        op: '-',
        expr,
        loc: { line: opToken.line, col: opToken.col },
      };
    }

    return this.parsePrimaryExpr();
  }

  private parsePrimaryExpr(): Expr {
    const token = this.peek();

    if (token.type === 'INT') {
      this.advance();
      return {
        kind: 'IntLiteral',
        value: parseInt(token.value, 10),
        loc: { line: token.line, col: token.col },
      };
    }

    if (token.type === 'KW_INPUT') {
      return this.parseInputExpr();
    }

    if (token.type === 'ID') {
      const idToken = this.advance();
      const loc = { line: idToken.line, col: idToken.col };

      if (this.match('LBRACK')) {
        const indexExpr = this.parseExpr();
        this.consume('RBRACK', "Expected ']' after array index");
        return {
          kind: 'ArrayAccess',
          name: idToken.value,
          index: indexExpr,
          loc,
        };
      }

      return {
        kind: 'Var',
        name: idToken.value,
        loc,
      };
    }

    if (this.match('LPAREN')) {
      const expr = this.parseExpr();
      this.consume('RPAREN', "Expected ')' after parenthesized expression");
      return expr;
    }

    throw new ParserError(
      `Unexpected token '${token.value || token.type}' when parsing expression`,
      token.line,
      token.col
    );
  }

  private parseInputExpr(): InputExpr {
    const kwToken = this.consume('KW_INPUT', "Expected 'input'");
    const loc: SourceLocation = { line: kwToken.line, col: kwToken.col };

    this.consume('LPAREN', "Expected '(' after 'input'");
    const minVal = this.parseSignedIntLiteral();
    this.consume('COMMA', "Expected ',' between input bounds");
    const maxVal = this.parseSignedIntLiteral();
    this.consume('RPAREN', "Expected ')' after input bounds");

    return {
      kind: 'Input',
      min: minVal,
      max: maxVal,
      loc,
    };
  }

  private parseSignedIntLiteral(): number {
    let sign = 1;
    if (this.match('MINUS')) {
      sign = -1;
    }
    const intToken = this.consume('INT', 'Expected integer literal');
    return sign * parseInt(intToken.value, 10);
  }

  // ---------------------------------------------------------------------------
  // Utility methods
  // ---------------------------------------------------------------------------

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private match(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) {
      return this.advance();
    }
    const token = this.peek();
    throw new ParserError(
      `${message}, got '${token.value || token.type}'`,
      token.line,
      token.col
    );
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.pos++;
    return this.tokens[this.pos - 1];
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'EOF';
  }
}
